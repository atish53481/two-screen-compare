'use client';

import { useEffect, useState } from 'react';

export default function DevApp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [users, setUsers] = useState(1250);
  const [revenue] = useState(1248000);

  useEffect(() => {
    if (!isLoggedIn) return;
    fetch('/api/stats').catch(() => {});
  }, [isLoggedIn]);

  const handleLogin = () => {
    if (email === 'test@acme.com' && password === 'password123') {
      setIsLoggedIn(true);
      setTimeout(() => setShowModal(true), 600);
    } else {
      alert('✅ Use these credentials:\n\nEmail: test@acme.com\nPassword: password123');
    }
  };

  const closeModal = () => setShowModal(false);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* DEV Banner */}
      <div className="dev-banner py-2 text-center text-sm font-medium tracking-wider">
        🧪 DEVELOPMENT ENVIRONMENT — Latest Features
      </div>

      <div className="max-w-4xl mx-auto p-8">
        <div className="flex justify-between items-center mb-12">
          <div>
            <h1 className="text-5xl font-bold tracking-tighter text-emerald-400">ACME Corp</h1>
            <p className="text-emerald-300/70 text-xl">Enterprise Dashboard</p>
          </div>
          <div className="flex gap-6 text-sm">
            <div className="text-center">
              {/* deliberate fixture difference: 1,250 (DEV) vs 1,248 (PROD) */}
              <div data-testid="stat-active-users" className="text-3xl font-mono text-emerald-400">{users.toLocaleString()}</div>
              <div className="text-xs uppercase tracking-widest text-emerald-500">Active Users</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-mono text-emerald-400">${(revenue/1000000).toFixed(1)}M</div>
              <div className="text-xs uppercase tracking-widest text-emerald-500">Revenue</div>
            </div>
          </div>
        </div>

        {!isLoggedIn ? (
          <div className="max-w-md mx-auto bg-zinc-900 rounded-3xl p-10 border border-emerald-900">
            <h2 className="text-3xl font-semibold mb-8 text-center">Login to DEV</h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Email Address</label>
                <input
                  type="email"
                  name="email"
                  data-testid="login-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-6 py-4 focus:outline-none focus:border-emerald-500 transition-colors"
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
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-6 py-4 focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="••••••••"
                />
              </div>

              <button
                type="button"
                data-testid="login-submit"
                onClick={handleLogin}
                className="w-full bg-emerald-600 hover:bg-emerald-500 py-4 rounded-2xl font-semibold text-lg transition-all active:scale-95"
              >
                Sign In to Development
              </button>

              <p className="text-center text-xs text-zinc-500">
                DEV environment contains latest experimental features and test data
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <img data-testid="logo" width={48} height={48} src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect width='48' height='48' fill='%23888'/%3E%3C/svg%3E" />
            {/* deliberate fixture difference: 3 order rows on DEV (DEV 3, PROD 2) */}
            <table data-testid="orders" className="text-sm text-zinc-300">
              <thead>
                <tr><th>Order</th><th>Customer</th><th>Total</th></tr>
              </thead>
              <tbody>
                <tr><td>1001</td><td>Acme Co</td><td>$120</td></tr>
                <tr><td>1002</td><td>Globex</td><td>$340</td></tr>
                <tr><td>1003</td><td>Initech</td><td>$99</td></tr>
              </tbody>
            </table>
            <div className="bg-zinc-900 rounded-3xl p-10">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center text-2xl">🚀</div>
                <div>
                  <div className="text-2xl font-semibold">Welcome back, Admin</div>
                  <div className="text-emerald-400">Development Environment • Build 2026.11</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <button
                  type="button"
                  data-testid="btn-reports"
                  onClick={() => alert('Reports opened in DEV (new chart library)')}
                  className="bg-zinc-800 hover:bg-zinc-700 p-8 rounded-3xl text-left transition-all border border-emerald-900 hover:border-emerald-500 group"
                >
                  <div className="text-emerald-400 text-sm mb-2 group-hover:underline">REPORTS →</div>
                  <div className="text-2xl font-semibold">Q4 Performance</div>
                  <div className="text-zinc-400 mt-6">New interactive charts available only in DEV</div>
                </button>

                <button
                  type="button"
                  data-testid="btn-add-user"
                  onClick={() => {
                    setUsers(users + 12);
                    alert('New user registered in DEV database');
                  }}
                  className="bg-zinc-800 hover:bg-zinc-700 p-8 px-6 rounded-3xl text-left transition-all border border-emerald-900 hover:border-emerald-500 group" // deliberate fixture difference: px-6 vs PROD px-4
                >
                  <div className="text-emerald-400 text-sm mb-2 group-hover:underline">ADD TEST USER →</div>
                  <div className="text-2xl font-semibold">Simulate Traffic</div>
                  <div className="text-zinc-400 mt-6">Live counter only updates in DEV</div>
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
            <div className="bg-zinc-900 rounded-3xl p-10 max-w-md text-center border border-emerald-500">
              <div className="text-6xl mb-6">🎉</div>
              <h3 className="text-3xl font-bold mb-4 text-emerald-400">Welcome to DEV</h3>
              <p className="text-zinc-400 mb-8">This environment contains new UI components, updated validation messages, and test data that differs from Production.</p>
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
