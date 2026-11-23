'use client';

import { useState } from 'react';

export default function ProdApp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [users] = useState(1248); // Different from DEV
  const [revenue] = useState(1248000);

  const handleLogin = () => {
    if (email === 'test@acme.com' && password === 'password123') {
      setIsLoggedIn(true);
      setTimeout(() => setShowModal(true), 800);
    } else {
      alert('✅ Use these credentials:\n\nEmail: test@acme.com\nPassword: password123');
    }
  };

  const closeModal = () => setShowModal(false);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* PROD Banner */}
      <div className="prod-banner py-2 text-center text-sm font-medium tracking-wider">
        ✅ PRODUCTION ENVIRONMENT — Stable Release v2026.08
      </div>

      <div className="max-w-4xl mx-auto p-8">
        <div className="flex justify-between items-center mb-12">
          <div>
            <h1 className="text-5xl font-bold tracking-tighter text-blue-400">ACME Corp</h1>
            <p className="text-blue-300/70 text-xl">Enterprise Dashboard</p>
          </div>
          <div className="flex gap-6 text-sm">
            <div className="text-center">
              <div className="text-3xl font-mono text-blue-400">{users.toLocaleString()}</div>
              <div className="text-xs uppercase tracking-widest text-blue-500">Active Users</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-mono text-blue-400">${(revenue/1000000).toFixed(1)}M</div>
              <div className="text-xs uppercase tracking-widest text-blue-500">Revenue</div>
            </div>
          </div>
        </div>

        {!isLoggedIn ? (
          <div className="max-w-md mx-auto bg-zinc-900 rounded-3xl p-10 border border-blue-900">
            <h2 className="text-3xl font-semibold mb-8 text-center">Login to Production</h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Email Address</label>
                <input
                  type="email"
                  name="email"
                  data-testid="login-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-6 py-4 focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="test@acme.com"
                />
              </div>
              
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Password</label>
                <input
                  type="password"
                  name="password"
                  data-testid="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-6 py-4 focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="••••••••"
                />
              </div>

              <button
                type="button"
                data-testid="login-submit"
                onClick={handleLogin}
                className="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-2xl font-semibold text-lg transition-all active:scale-95"
              >
                Sign In to Production
              </button>

              <p className="text-center text-xs text-zinc-500">
                This is the certified production environment
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="bg-zinc-900 rounded-3xl p-10">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center text-2xl">🏢</div>
                <div>
                  <div className="text-2xl font-semibold">Welcome back, Admin</div>
                  <div className="text-blue-400">Production Environment • Certified Stable</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <button
                  type="button"
                  data-testid="btn-reports"
                  onClick={() => alert('Standard reports opened (classic charts)')}
                  className="bg-zinc-800 hover:bg-zinc-700 p-8 rounded-3xl text-left transition-all border border-blue-900 hover:border-blue-500 group"
                >
                  <div className="text-blue-400 text-sm mb-2 group-hover:underline">REPORTS →</div>
                  <div className="text-2xl font-semibold">Q4 Performance</div>
                  <div className="text-zinc-400 mt-6">Uses stable chart library (different from DEV)</div>
                </button>

                <button
                  type="button"
                  data-testid="btn-add-user"
                  onClick={() => alert('User registration is disabled in PRODUCTION for safety')}
                  className="bg-zinc-800 hover:bg-zinc-700 p-8 rounded-3xl text-left transition-all border border-blue-900 hover:border-blue-500 group opacity-75"
                >
                  <div className="text-blue-400 text-sm mb-2 group-hover:underline">ADD USER (DISABLED)</div>
                  <div className="text-2xl font-semibold">Production Safety Mode</div>
                  <div className="text-zinc-400 mt-6">Counter is static in PROD</div>
                </button>
              </div>
            </div>

            <button
              type="button"
              data-testid="btn-logout"
              onClick={() => setIsLoggedIn(false)}
              className="text-zinc-400 hover:text-white text-sm flex items-center gap-2"
            >
              ← Logout
            </button>
          </div>
        )}

        {showModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <div className="bg-zinc-900 rounded-3xl p-10 max-w-md text-center border border-blue-500">
              <div className="text-6xl mb-6">🛡️</div>
              <h3 className="text-3xl font-bold mb-4 text-blue-400">Production Access Confirmed</h3>
              <p className="text-zinc-400 mb-8">All changes are audited. This environment has stricter validation messages and slightly different test data than Development.</p>
              <button
                type="button"
                data-testid="btn-continue-dashboard"
                onClick={closeModal}
                className="bg-white text-black px-10 py-4 rounded-2xl font-semibold hover:bg-zinc-200"
              >
                Continue to Dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
