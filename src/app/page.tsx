"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface Neighbor {
  address: string;
  lat: number;
  lng: number;
  streetViewUrl: string;
}

interface GeneratedResult {
  address: string;
  originalUrl: string;
  generatedUrl: string | null;
  error: string | null;
}

interface Prediction {
  description: string;
  placeId: string;
}

interface User {
  userId: string;
  email: string;
  name: string;
  picture: string;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState<Prediction[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [neighbors, setNeighbors] = useState<Neighbor[]>([]);
  const [customerAddress, setCustomerAddress] = useState("");
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generatingSingle, setGeneratingSingle] = useState<Record<number, boolean>>({});
  const [results, setResults] = useState<Record<number, GeneratedResult>>({});
  const [error, setError] = useState("");
  const [freeUsed, setFreeUsed] = useState(false);
  const [balanceCents, setBalanceCents] = useState(0);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [buyAmount, setBuyAmount] = useState(1000);
  const [buyLoading, setBuyLoading] = useState(false);
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Check auth status
  useEffect(() => {
    fetch("/api/auth/me")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((r) => r.json() as Promise<any>)
      .then((data) => { setUser(data.user || null); setAuthLoading(false); })
      .catch(() => setAuthLoading(false));
  }, []);

  const fetchCredits = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/credits");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      if (data.error !== "UNAUTHORIZED") {
        setFreeUsed(data.freeUsed);
        setBalanceCents(data.balanceCents);
      }
    } catch { /* ignore */ }
  }, [user]);

  useEffect(() => {
    if (user) fetchCredits();
  }, [user, fetchCredits]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success") {
      window.history.replaceState({}, "", "/");
      setTimeout(fetchCredits, 2000);
    }
  }, [user, fetchCredits]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setShowSuggestions(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setNeighbors([]);
    setResults({});
  };

  const fetchSuggestions = (query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 3) { setSuggestions([]); setShowSuggestions(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (await res.json()) as any;
        setSuggestions(data.predictions);
        setShowSuggestions(data.predictions.length > 0);
      } catch { setSuggestions([]); }
    }, 300);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAddress(e.target.value);
    fetchSuggestions(e.target.value);
  };

  const selectSuggestion = (p: Prediction) => {
    setAddress(p.description);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const findNeighbors = async () => {
    if (!address.trim()) return;
    setShowSuggestions(false);
    setLoading(true);
    setError("");
    setNeighbors([]);
    setResults({});
    try {
      const res = await fetch("/api/neighbors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      if (!res.ok) throw new Error(data.error);
      setCustomerAddress(data.customerAddress);
      setNeighbors(data.neighbors);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async (neighborsList: Neighbor[], indices: number[]) => {
    setError("");
    try {
      const res = await fetch("/api/generate-lights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          neighbors: neighborsList.map((n) => ({ imageUrl: n.streetViewUrl, address: n.address })),
        }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      if (data.error === "NO_CREDITS") { setShowBuyModal(true); return; }
      if (data.error === "UNAUTHORIZED") { window.location.href = "/api/auth/login"; return; }
      if (!res.ok) throw new Error(data.error || data.message);
      setResults((prev) => {
        const next = { ...prev };
        data.results.forEach((r: GeneratedResult, i: number) => { next[indices[i]] = r; });
        return next;
      });
      setFreeUsed(data.freeUsed);
      setBalanceCents(data.balanceCents);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Generation failed");
    }
  };

  const generateAll = async () => {
    setGeneratingAll(true);
    const ungenerated = neighbors.map((n, i) => ({ n, i })).filter(({ i }) => !results[i]);
    await handleGenerate(ungenerated.map(({ n }) => n), ungenerated.map(({ i }) => i));
    setGeneratingAll(false);
  };

  const generateSingle = async (index: number, neighbor: Neighbor) => {
    setGeneratingSingle((prev) => ({ ...prev, [index]: true }));
    await handleGenerate([neighbor], [index]);
    setGeneratingSingle((prev) => ({ ...prev, [index]: false }));
  };

  const handleBuyCredits = async () => {
    setBuyLoading(true);
    setError("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents: buyAmount }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      if (data.error === "UNAUTHORIZED") { window.location.href = "/api/auth/login"; return; }
      if (!res.ok) { setError(data.error || "Checkout failed"); setBuyLoading(false); return; }
      if (data.clientSecret) { setCheckoutClientSecret(data.clientSecret); }
      else { setError("Could not start checkout"); }
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Could not start checkout"); } finally { setBuyLoading(false); }
  };

  const closeBuyModal = () => {
    setShowBuyModal(false);
    setCheckoutClientSecret(null);
    fetchCredits();
  };

  const completedCount = Object.values(results).filter((r) => r?.generatedUrl).length;
  const allDone = completedCount === neighbors.length && neighbors.length > 0;
  const balanceDisplay = (balanceCents / 100).toFixed(2);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white antialiased">
      <div className="fixed inset-0 bg-gradient-to-br from-indigo-950/20 via-transparent to-purple-950/10 pointer-events-none" />

      <header className="relative z-10 border-b border-white/[0.06]">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18h6M10 22h4M12 2v1M4.2 4.2l.7.7M1 12h1M20.8 4.2l-.7.7M22 12h1" />
                  <path d="M12 6a6 6 0 0 0-4 10.5V18h8v-1.5A6 6 0 0 0 12 6z" />
                </svg>
              </div>
              <h1 className="text-lg font-semibold tracking-tight text-white">Holiday Lights Preview</h1>
            </div>
            {user ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06]">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span className="text-xs text-white/50"><span className="text-white/80 font-medium">${balanceDisplay}</span> balance</span>
                </div>
                <button onClick={() => setShowBuyModal(true)} className="px-3 py-1.5 text-xs font-medium rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-400 hover:to-orange-400 transition-all">Add Funds</button>
                <div className="flex items-center gap-2 ml-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={user.picture} alt="" className="w-7 h-7 rounded-full" />
                  <button onClick={logout} className="text-xs text-white/30 hover:text-white/60 transition-colors">Sign out</button>
                </div>
              </div>
            ) : (
              <a href="/api/auth/login" className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-medium rounded-xl hover:bg-white/90 transition-all">
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Sign in
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-5xl mx-auto px-6 py-10">
        {/* Search */}
        <div className="mb-12">
          <div className="flex gap-2">
            <div className="relative flex-1" ref={wrapperRef}>
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
              </div>
              <input type="text" value={address} onChange={handleInputChange} onFocus={() => suggestions.length > 0 && setShowSuggestions(true)} onKeyDown={(e) => e.key === "Enter" && findNeighbors()} placeholder="Enter an address to get started..." className="w-full pl-11 pr-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all" />
              {showSuggestions && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-[#16161f] border border-white/[0.08] rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50">
                  {suggestions.map((prediction, i) => (
                    <button key={prediction.placeId} onClick={() => selectSuggestion(prediction)} className={`w-full text-left px-4 py-3 text-sm hover:bg-white/[0.04] transition-colors flex items-center gap-3 ${i > 0 ? "border-t border-white/[0.04]" : ""}`}>
                      <span className="text-white/20"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg></span>
                      <span><span className="text-white/80 font-medium">{prediction.description.split(",")[0]}</span><span className="text-white/30">,{prediction.description.split(",").slice(1).join(",")}</span></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={findNeighbors} disabled={loading || !address.trim()} className="px-6 py-3.5 bg-white text-black text-sm font-medium rounded-xl hover:bg-white/90 disabled:bg-white/10 disabled:text-white/20 transition-all whitespace-nowrap">
              {loading ? (<span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />Searching</span>) : "Find Neighbors"}
            </button>
          </div>
          {error && <p className="mt-3 text-red-400/80 text-sm">{error}</p>}
        </div>

        {/* Results header */}
        {customerAddress && (
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-1 h-6 rounded-full bg-gradient-to-b from-amber-400 to-orange-500" />
              <div>
                <p className="text-xs text-white/30 uppercase tracking-wider font-medium">Neighbors of</p>
                <p className="text-sm text-white/70">{customerAddress}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {completedCount > 0 && !allDone && <span className="text-xs text-white/30">{completedCount}/{neighbors.length} generated</span>}
              {!allDone && neighbors.length > 0 && (
                <button onClick={generateAll} disabled={generatingAll} className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold rounded-xl hover:from-amber-400 hover:to-orange-400 disabled:from-white/10 disabled:to-white/10 disabled:text-white/30 transition-all">
                  {generatingAll ? (<span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Generating...</span>) : (<>Generate All — {!freeUsed ? <span className="ml-1 px-2 py-0.5 bg-emerald-500/30 text-emerald-300 text-[10px] rounded-full font-bold uppercase">Free</span> : "$2.00"}</>)}
                </button>
              )}
              {allDone && (<span className="flex items-center gap-1.5 text-xs text-emerald-400/70"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>All generated</span>)}
            </div>
          </div>
        )}

        {!freeUsed && neighbors.length > 0 && completedCount === 0 && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <p className="text-sm text-emerald-300/80">Your first address is <span className="font-semibold text-emerald-300">free</span> — all 5 neighbors included!</p>
          </div>
        )}

        {/* Neighbors grid */}
        <div className="space-y-4">
          {neighbors.map((neighbor, index) => {
            const result = results[index];
            const isSingleGenerating = generatingSingle[index];
            return (
              <div key={index} className="group rounded-2xl overflow-hidden bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.1] transition-all">
                <div className="px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-bold text-white/40">{index + 1}</span>
                    <span className="text-sm text-white/60">{neighbor.address}</span>
                  </div>
                  {result?.generatedUrl ? (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-400/70"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>Done</span>
                  ) : !generatingAll && !isSingleGenerating ? (
                    <button onClick={() => generateSingle(index, neighbor)} className="px-4 py-1.5 text-xs font-medium rounded-lg bg-white/[0.06] text-white/60 hover:bg-white/[0.1] hover:text-white/80 transition-all">Generate — $0.50</button>
                  ) : null}
                </div>
                <div className="grid md:grid-cols-2">
                  <div className="relative">
                    <div className="absolute top-3 left-3 z-10"><span className="px-2.5 py-1 text-[10px] uppercase tracking-widest font-semibold bg-black/50 text-white/60 rounded-md backdrop-blur-md">Before</span></div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={neighbor.streetViewUrl} alt={`Street view of ${neighbor.address}`} className="w-full h-72 object-cover" />
                  </div>
                  <div className="relative">
                    {result?.generatedUrl ? (
                      <>
                        <div className="absolute top-3 left-3 z-10"><span className="px-2.5 py-1 text-[10px] uppercase tracking-widest font-semibold bg-amber-500/80 text-white rounded-md backdrop-blur-md">After</span></div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={result.generatedUrl} alt={`${neighbor.address} with holiday lights`} className="w-full h-72 object-cover" />
                      </>
                    ) : (generatingAll || isSingleGenerating) ? (
                      <div className="flex items-center justify-center h-72 bg-white/[0.02]">
                        <div className="text-center"><div className="relative w-10 h-10 mx-auto mb-3"><div className="absolute inset-0 rounded-full border-2 border-white/[0.06]" /><div className="absolute inset-0 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" /></div><p className="text-xs text-white/30">Adding holiday lights...</p></div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-72 bg-white/[0.02]">
                        <div className="text-center"><div className="w-10 h-10 mx-auto mb-2 rounded-full bg-white/[0.04] flex items-center justify-center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/15"><path d="M9 18h6M10 22h4M12 2v1" /><path d="M12 6a6 6 0 0 0-4 10.5V18h8v-1.5A6 6 0 0 0 12 6z" /></svg></div><p className="text-xs text-white/20">Preview will appear here</p></div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {!loading && neighbors.length === 0 && !customerAddress && (
          <div className="text-center py-24">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/15"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg></div>
            <p className="text-sm text-white/25">Enter an address above to find nearby homes</p>
          </div>
        )}
        {!loading && neighbors.length === 0 && customerAddress && (
          <div className="text-center py-24"><p className="text-sm text-white/25">No neighbors found for this address. Try a different one.</p></div>
        )}
      </main>

      {/* Buy Modal */}
      {showBuyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeBuyModal} />
          <div className={`relative bg-[#12121a] border border-white/[0.08] rounded-2xl p-8 ${checkoutClientSecret ? "max-w-lg" : "max-w-sm"} w-full mx-4 shadow-2xl max-h-[90vh] overflow-y-auto`}>
            <button onClick={closeBuyModal} className="absolute top-4 right-4 text-white/30 hover:text-white/60 transition-colors z-10"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg></button>
            {checkoutClientSecret ? (
              <div id="checkout">
                <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret: checkoutClientSecret }}>
                  <EmbeddedCheckout />
                </EmbeddedCheckoutProvider>
              </div>
            ) : (
              <>
                <div className="text-center mb-6">
                  <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-gradient-to-br from-amber-400/20 to-orange-500/20 border border-amber-500/20 flex items-center justify-center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-400"><path d="M9 18h6M10 22h4M12 2v1" /><path d="M12 6a6 6 0 0 0-4 10.5V18h8v-1.5A6 6 0 0 0 12 6z" /></svg></div>
                  <h2 className="text-lg font-semibold text-white mb-1">Add Funds</h2>
                  <p className="text-sm text-white/40">$2 for all 5 neighbors, or $0.50 each</p>
                </div>
                <div className="mb-6">
                  <div className="grid grid-cols-4 gap-2">
                    {[{ cents: 200, label: "$2" }, { cents: 500, label: "$5" }, { cents: 1000, label: "$10" }, { cents: 2500, label: "$25" }].map(({ cents, label }) => (
                      <button key={cents} onClick={() => setBuyAmount(cents)} className={`py-3 rounded-xl text-center transition-all ${buyAmount === cents ? "bg-amber-500/20 border border-amber-500/40 text-amber-300" : "bg-white/[0.04] border border-white/[0.06] text-white/50 hover:bg-white/[0.06]"}`}>
                        <div className="text-lg font-bold">{label}</div>
                        <div className="text-[10px] text-white/30">{Math.floor(cents / 200)} addr{Math.floor(cents / 200) !== 1 ? "s" : ""}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={handleBuyCredits} disabled={buyLoading} className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold rounded-xl hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 transition-all">
                  {buyLoading ? (<span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Loading...</span>) : `Add $${(buyAmount / 100).toFixed(2)} to balance`}
                </button>
                <p className="text-[11px] text-white/20 text-center mt-4">Secure payment via Stripe</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
