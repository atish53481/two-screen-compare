import Anthropic from '@anthropic-ai/sdk';
import type { BetaTextBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { AiAnalysis, Classification, Finding } from './types';
import { SENSITIVE_FIELD_RE } from './extract';
import { redactSecrets } from './runtime-diff';

export interface AiProvider {
  name: string;
  model: string;
  complete(system: string, user: string, signal: AbortSignal): Promise<string>;
}

export interface AnalyzeOptions {
  timeoutMs: number;
  maxFindings: number;
  batchSize: number;
}

export const DEFAULT_AI_OPTIONS: AnalyzeOptions = { timeoutMs: 30000, maxFindings: 40, batchSize: 10 };

const CLASSIFICATIONS: Classification[] = [
  'MATCH',
  'EXPECTED_DIFFERENCE',
  'POTENTIAL_DEFECT',
  'REPLAY_FAILURE',
  'NOT_COMPARABLE',
  'SKIPPED_BY_SAFETY_POLICY',
  'UNMAPPED_OR_MISSING_FEATURE',
];

const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

/** Server-side only. Never logs keys. Returns null when AI is not (fully) configured. */
export function providerFromEnv(env: Record<string, string | undefined>): AiProvider | null {
  const kind = (env.QA_VISION_AI_PROVIDER || '').trim();
  if (kind === 'anthropic') {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    const model = env.QA_VISION_AI_MODEL || DEFAULT_ANTHROPIC_MODEL;
    const client = new Anthropic({ apiKey });
    return {
      name: 'anthropic',
      model,
      async complete(system, user, signal) {
        // Thinking is always on for this model: do not send `thinking`, temperature, top_p or top_k.
        const res = await client.beta.messages.create(
          {
            model,
            max_tokens: 16000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { effort: 'medium' },
            system,
            messages: [{ role: 'user', content: user }],
          },
          { signal }
        );
        if (res.stop_reason === 'refusal') throw new Error('refused');
        return res.content
          .filter((b): b is BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
      },
    };
  }
  if (kind === 'openai-compatible') {
    const base = (env.QA_VISION_AI_BASE_URL || '').replace(/\/+$/, '');
    const apiKey = env.QA_VISION_AI_API_KEY;
    const model = env.QA_VISION_AI_MODEL;
    if (!base || !apiKey || !model) return null;
    return {
      name: 'openai-compatible',
      model,
      async complete(system, user, signal) {
        const res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
          signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: any = await res.json();
        const content = json?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error('Unexpected response shape');
        return content;
      },
    };
  }
  return null;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const TOKEN_RE = /[A-Za-z0-9_\-+/=]{16,}/g;
const DIGITS_RE = /\d{9,}/g;
const MARKER_RE = /\[redacted\]/gi;
const R = '<redacted>';

/** Drops query strings and fragments from relative URL paths (absolute URLs are handled by redactSecrets). */
function stripRelativeQuery(s: string): string {
  return s.replace(/(^|[\s"'(])(\/[^\s?#"')]*)[?#][^\s"')]*/g, '$1$2');
}

function scrub(value: unknown, sensitiveRe: RegExp): string {
  let s = redactSecrets(String(value ?? ''), sensitiveRe);
  s = stripRelativeQuery(s);
  return s.replace(MARKER_RE, R).replace(EMAIL_RE, R).replace(UUID_RE, R).replace(DIGITS_RE, R).replace(TOKEN_RE, R).replace(/\[redacted\]/g, R);
}

/** Keeps only the fields the model needs. No screenshot paths, no URL queries. */
export function redactForAi(f: Finding, sensitiveRe: RegExp): Record<string, unknown> {
  const sensitive = sensitiveRe.test(`${f.component ?? ''} ${f.property ?? ''}`);
  return {
    id: f.id,
    type: f.type,
    component: scrub(f.component, sensitiveRe),
    property: f.property == null ? undefined : scrub(f.property, sensitiveRe),
    page: scrub(f.page, sensitiveRe),
    devValue: sensitive ? R : scrub(f.devValue, sensitiveRe),
    prodValue: sensitive ? R : scrub(f.prodValue, sensitiveRe),
    description: scrub(f.description, sensitiveRe),
    classification: f.classification,
    stepIds: f.stepIds,
  };
}

export function buildPrompt(findings: object[]): { system: string; user: string } {
  const system = [
    'You analyze deterministic differences found between a DEV and a PROD build of the same web application.',
    'Each finding was produced by a deterministic comparison engine; treat the engine output as ground truth about what differed.',
    'Separate observed facts (taken only from the supplied finding data) from hypotheses (your inference about the cause).',
    'Do not claim a defect without evidence in the supplied data; say what evidence is missing instead.',
    'Never suggest deploying or modifying code automatically; only suggest manual investigation and additional tests.',
    'Values marked <redacted> were removed for privacy; do not try to guess them.',
    `proposedClassification is optional and advisory; if given it must be one of: ${CLASSIFICATIONS.join(', ')}.`,
    'Reply with JSON only, in exactly this shape:',
    '{"results":[{"id":"<finding id>","explanation":"","observedFacts":[],"hypotheses":[],"suggestedInvestigation":[],"additionalTests":[],"proposedClassification":"","confidence":0.0}]}',
  ].join('\n');
  const user = `Analyze these findings (JSON):\n${JSON.stringify(findings)}`;
  return { system, user };
}

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 10).map((x) => x.slice(0, 500)) : [];

function parseResults(text: string): any[] {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const parsed = JSON.parse(t);
  if (!parsed || !Array.isArray(parsed.results)) throw new Error('Missing results array');
  return parsed.results;
}

function errorMessage(e: unknown): string {
  const err = e as any;
  if (err?.name === 'AbortError' || err?.name === 'APIUserAbortError') return 'timeout';
  if (typeof err?.status === 'number') return `HTTP ${err.status}`;
  return String(err?.message || 'error').slice(0, 200);
}

/** Never throws. Does not mutate the findings. */
export async function analyzeFindings(
  findings: Finding[],
  provider: AiProvider | null,
  opts: AnalyzeOptions = DEFAULT_AI_OPTIONS
): Promise<Map<string, AiAnalysis>> {
  const out = new Map<string, AiAnalysis>();
  const base = (status: AiAnalysis['status'], error?: string): AiAnalysis => ({
    status,
    provider: provider?.name ?? 'none',
    model: provider?.model ?? '',
    explanation: '',
    observedFacts: [],
    hypotheses: [],
    suggestedInvestigation: [],
    additionalTests: [],
    ...(error ? { error } : {}),
    generatedAt: new Date().toISOString(),
  });

  try {
    const list = (findings ?? []).slice(0, Math.max(0, opts.maxFindings));
    if (!provider) {
      for (const f of list) out.set(f.id, base('unavailable'));
      return out;
    }
    const size = Math.max(1, opts.batchSize);
    for (let i = 0; i < list.length; i += size) {
      const batch = list.slice(i, i + size);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
      try {
        const { system, user } = buildPrompt(batch.map((f) => redactForAi(f, SENSITIVE_FIELD_RE)));
        const text = await Promise.race([
          provider.complete(system, user, ctrl.signal),
          new Promise<never>((_, rej) =>
            ctrl.signal.addEventListener('abort', () =>
              rej(Object.assign(new Error('timeout'), { name: 'AbortError' }))
            )
          ),
        ]);
        const results = parseResults(text);
        const byId = new Map<string, any>(results.map((r) => [String(r?.id), r]));
        for (const f of batch) {
          const r = byId.get(f.id);
          if (!r) {
            out.set(f.id, base('error', 'No result returned for finding'));
            continue;
          }
          const a = base('ok');
          a.explanation = typeof r.explanation === 'string' ? r.explanation.slice(0, 2000) : '';
          a.observedFacts = strArr(r.observedFacts);
          a.hypotheses = strArr(r.hypotheses);
          a.suggestedInvestigation = strArr(r.suggestedInvestigation);
          a.additionalTests = strArr(r.additionalTests);
          if (CLASSIFICATIONS.includes(r.proposedClassification)) a.proposedClassification = r.proposedClassification;
          if (typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 1) a.confidence = r.confidence;
          out.set(f.id, a);
        }
      } catch (e) {
        for (const f of batch) out.set(f.id, base('error', errorMessage(e)));
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (e) {
    for (const f of findings ?? []) if (!out.has(f.id)) out.set(f.id, base('error', errorMessage(e)));
  }
  return out;
}
