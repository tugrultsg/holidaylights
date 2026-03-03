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
  const [freeUsed, setFreeUsed] = useState(0);
  const [balanceCents, setBalanceCents] = useState(0);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [buyAmount, setBuyAmount] = useState(1000);
  const [buyLoading, setBuyLoading] = useState(false);
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => { if (user) fetchCredits(); }, [user, fetchCredits]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success") {
      window.history.replaceState({}, "", "/");
      if (user) setTimeout(fetchCredits, 2000);
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
  const freeRemaining = Math.max(0, 5 - freeUsed);
  const hasSearched = customerAddress !== "";

  if (authLoading) return null;

  return (
    <div className="min-h-screen bg-[#050507] text-white antialiased overflow-x-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="orb absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-amber-500/[0.03] blur-[120px]" />
        <div className="orb-2 absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-500/[0.04] blur-[100px]" />
      </div>

      {/* Header */}
      <header className="relative z-20 border-b border-white/[0.04]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18h6M10 22h4M12 2v1M4.2 4.2l.7.7M1 12h1M20.8 4.2l-.7.7M22 12h1" />
                <path d="M12 6a6 6 0 0 0-4 10.5V18h8v-1.5A6 6 0 0 0 12 6z" />
              </svg>
            </div>
            <span className="text-[15px] font-semibold tracking-tight">Holiday Lights</span>
          </div>
          {user ? (
            <div className="flex items-center gap-2">
              <button onClick={() => setShowBuyModal(true)} className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.07] transition-all text-xs">
                <span className="text-amber-400 font-semibold">${balanceDisplay}</span>
                <span className="text-white/30">|</span>
                <span className="text-white/50">Add Funds</span>
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={user.picture} alt="" className="w-8 h-8 rounded-full ring-2 ring-white/[0.06] ml-1 cursor-pointer" onClick={logout} title="Sign out" />
            </div>
          ) : (
            <a href="/api/auth/login" className="flex items-center gap-2 px-4 py-2 bg-white/[0.06] border border-white/[0.08] text-white text-sm font-medium rounded-full hover:bg-white/[0.1] transition-all">
              <svg width="14" height="14" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in
            </a>
          )}
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero / Search section */}
        {!hasSearched && (
          <div className="max-w-6xl mx-auto px-6 pt-24 pb-16 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-medium mb-8">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
              AI-Powered Preview
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] mb-5">
              See holiday lights on
              <br />
              <span className="bg-gradient-to-r from-amber-300 via-orange-400 to-rose-400 bg-clip-text text-transparent">any home instantly</span>
            </h1>
            <p className="text-base sm:text-lg text-white/35 max-w-xl mx-auto mb-12 leading-relaxed">
              Enter an address and we&apos;ll find the 5 closest neighbors, then use AI to preview professional holiday light installations on each home.
            </p>
          </div>
        )}

        {/* Search bar */}
        <div className={`max-w-6xl mx-auto px-6 ${hasSearched ? "pt-8 pb-6" : "pb-16"}`}>
          <div className={`${hasSearched ? "" : "max-w-2xl mx-auto"}`}>
            <div className="flex gap-2">
              <div className="relative flex-1" ref={wrapperRef}>
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                </div>
                <input
                  type="text"
                  value={address}
                  onChange={handleInputChange}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  onKeyDown={(e) => e.key === "Enter" && findNeighbors()}
                  placeholder="Enter a home address..."
                  className="w-full pl-12 pr-4 py-4 bg-white/[0.04] border border-white/[0.07] rounded-2xl text-white text-[15px] placeholder-white/20 focus:outline-none focus:border-amber-500/30 focus:bg-white/[0.06] focus:shadow-lg focus:shadow-amber-500/5 transition-all"
                />
                {showSuggestions && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-[#111118] border border-white/[0.08] rounded-2xl shadow-2xl shadow-black/60 overflow-hidden z-50">
                    {suggestions.map((prediction, i) => (
                      <button key={prediction.placeId} onClick={() => selectSuggestion(prediction)} className={`w-full text-left px-5 py-3.5 text-sm hover:bg-white/[0.04] transition-colors flex items-center gap-3 ${i > 0 ? "border-t border-white/[0.04]" : ""}`}>
                        <span className="text-white/15 flex-shrink-0">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                        </span>
                        <span className="truncate">
                          <span className="text-white/80 font-medium">{prediction.description.split(",")[0]}</span>
                          <span className="text-white/25">,{prediction.description.split(",").slice(1).join(",")}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={findNeighbors}
                disabled={loading || !address.trim()}
                className="px-7 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold rounded-2xl hover:from-amber-400 hover:to-orange-400 disabled:from-white/[0.06] disabled:to-white/[0.06] disabled:text-white/20 transition-all shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30 disabled:shadow-none whitespace-nowrap"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Searching
                  </span>
                ) : (
                  "Find Neighbors"
                )}
              </button>
            </div>
            {error && <p className="mt-3 text-red-400/80 text-sm">{error}</p>}

            {/* Feature pills - only on hero */}
            {!hasSearched && (
              <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
                {[
                  { icon: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", text: "5 neighbors per search" },
                  { icon: "M12 2v1M4.2 4.2l.7.7M1 12h1M20.8 4.2l-.7.7M22 12h1M9 18h6M10 22h4M12 6a6 6 0 0 0-4 10.5V18h8v-1.5A6 6 0 0 0 12 6z", text: "AI light generation" },
                  { icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z", text: "First 5 homes free" },
                ].map(({ text }, i) => (
                  <span key={i} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/30 bg-white/[0.02] border border-white/[0.04] rounded-full">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-amber-500/50"><polyline points="20 6 9 17 4 12" /></svg>
                    {text}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Results */}
        {hasSearched && (
          <div className="max-w-6xl mx-auto px-6 pb-16">
            {/* Results header bar */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/20 flex items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                </div>
                <div>
                  <p className="text-[13px] font-medium text-white/70">{customerAddress}</p>
                  <p className="text-[11px] text-white/25 mt-0.5">{neighbors.length} neighbors found {completedCount > 0 && `\u00B7 ${completedCount}/${neighbors.length} generated`}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {freeRemaining > 0 && (
                  <span className="px-3 py-1 text-[11px] font-medium rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    {freeRemaining} free left
                  </span>
                )}
                {!allDone && neighbors.length > 0 && (
                  <button
                    onClick={generateAll}
                    disabled={generatingAll}
                    className="px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold rounded-xl hover:from-amber-400 hover:to-orange-400 disabled:from-white/[0.06] disabled:to-white/[0.06] disabled:text-white/30 transition-all shadow-lg shadow-amber-500/15 disabled:shadow-none"
                  >
                    {generatingAll ? (
                      <span className="flex items-center gap-2">
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Generating...
                      </span>
                    ) : (
                      <>
                        Generate All
                        {freeRemaining >= (neighbors.length - completedCount)
                          ? <span className="ml-2 px-1.5 py-0.5 bg-white/20 text-[10px] rounded font-bold">FREE</span>
                          : <span className="ml-1 text-white/60">$2</span>
                        }
                      </>
                    )}
                  </button>
                )}
                {allDone && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full font-medium">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    Complete
                  </span>
                )}
              </div>
            </div>

            {/* Neighbors grid */}
            <div className="space-y-3">
              {neighbors.map((neighbor, index) => {
                const result = results[index];
                const isSingleGenerating = generatingSingle[index];
                return (
                  <div key={index} className="group rounded-2xl overflow-hidden bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.1] transition-all duration-300">
                    {/* Card header */}
                    <div className="px-5 py-3 flex items-center justify-between bg-white/[0.01]">
                      <div className="flex items-center gap-3">
                        <span className="w-7 h-7 rounded-lg bg-white/[0.05] flex items-center justify-center text-[11px] font-bold text-white/30">{index + 1}</span>
                        <span className="text-[13px] text-white/50 font-medium">{neighbor.address}</span>
                      </div>
                      {result?.generatedUrl ? (
                        <span className="flex items-center gap-1.5 text-xs text-emerald-400/80 font-medium">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                          Done
                        </span>
                      ) : !generatingAll && !isSingleGenerating ? (
                        <button onClick={() => generateSingle(index, neighbor)} className="px-4 py-1.5 text-xs font-medium rounded-lg bg-white/[0.05] text-white/50 hover:bg-amber-500/20 hover:text-amber-300 hover:border-amber-500/30 border border-transparent transition-all">
                          {freeRemaining > 0 ? "Generate \u00B7 Free" : "Generate \u00B7 $0.50"}
                        </button>
                      ) : null}
                    </div>
                    {/* Images */}
                    <div className="grid md:grid-cols-2">
                      <div className="relative overflow-hidden">
                        <div className="absolute top-3 left-3 z-10">
                          <span className="px-2.5 py-1 text-[10px] uppercase tracking-widest font-bold bg-black/60 text-white/50 rounded-lg backdrop-blur-xl">Before</span>
                        </div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={neighbor.streetViewUrl} alt={`Street view of ${neighbor.address}`} className="img-zoom w-full h-64 md:h-72 object-cover" />
                      </div>
                      <div className="relative overflow-hidden">
                        {result?.generatedUrl ? (
                          <>
                            <div className="absolute top-3 left-3 z-10">
                              <span className="px-2.5 py-1 text-[10px] uppercase tracking-widest font-bold bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg shadow-lg shadow-amber-500/20">After</span>
                            </div>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={result.generatedUrl} alt={`${neighbor.address} with holiday lights`} className="img-zoom w-full h-64 md:h-72 object-cover" />
                          </>
                        ) : (generatingAll || isSingleGenerating) ? (
                          <div className="flex items-center justify-center h-64 md:h-72 bg-gradient-to-br from-amber-500/[0.03] to-orange-500/[0.02]">
                            <div className="text-center">
                              <div className="relative w-12 h-12 mx-auto mb-3">
                                <div className="absolute inset-0 rounded-full border-2 border-amber-500/10" />
                                <div className="absolute inset-0 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
                              </div>
                              <p className="text-xs text-white/25 font-medium">Adding holiday lights...</p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-64 md:h-72 bg-white/[0.01]">
                            <div className="text-center">
                              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-white/[0.03] border border-white/[0.05] flex items-center justify-center">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/10">
                                  <path d="M9 18h6M10 22h4M12 2v1" />
                                  <path d="M12 6a6 6 0 0 0-4 10.5V18h8v-1.5A6 6 0 0 0 12 6z" />
                                </svg>
                              </div>
                              <p className="text-xs text-white/15">Click generate to preview</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {!loading && neighbors.length === 0 && (
              <div className="text-center py-24"><p className="text-sm text-white/20">No neighbors found for this address. Try a different one.</p></div>
            )}
          </div>
        )}

        {/* Empty state (no search yet, but loading ended) */}
        {!hasSearched && !loading && (
          <div className="max-w-6xl mx-auto px-6 pb-24">
            <div className="grid md:grid-cols-3 gap-4 max-w-3xl mx-auto">
              {[
                { step: "1", title: "Enter Address", desc: "Type your customer's address and we'll find nearby homes" },
                { step: "2", title: "Preview Lights", desc: "AI generates realistic holiday light installations" },
                { step: "3", title: "Close the Sale", desc: "Show homeowners their house with lights installed" },
              ].map(({ step, title, desc }) => (
                <div key={step} className="text-center p-6 rounded-2xl bg-white/[0.02] border border-white/[0.04]">
                  <div className="w-8 h-8 mx-auto mb-3 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/15 flex items-center justify-center text-xs font-bold text-amber-400">{step}</div>
                  <h3 className="text-sm font-semibold text-white/70 mb-1">{title}</h3>
                  <p className="text-xs text-white/25 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.03] py-6">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <span className="text-[11px] text-white/15">Holiday Lights Preview</span>
          <span className="text-[11px] text-white/15">Powered by AI</span>
        </div>
      </footer>

      {/* Buy Modal */}
      {showBuyModal && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={closeBuyModal} />
          {checkoutClientSecret ? (
            <div className="relative z-10 flex flex-col h-full">
              <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
                <div className="flex items-center gap-3">
                  <button onClick={() => setCheckoutClientSecret(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><polyline points="12 19 5 12 12 5" /></svg>
                  </button>
                  <span className="text-sm font-medium text-gray-900">Complete Payment</span>
                </div>
                <button onClick={closeBuyModal} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto bg-white">
                <div className="max-w-lg mx-auto py-8 px-6">
                  <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret: checkoutClientSecret, onComplete: () => { setTimeout(() => { closeBuyModal(); fetchCredits(); }, 1500); } }}>
                    <EmbeddedCheckout />
                  </EmbeddedCheckoutProvider>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative z-10 flex items-center justify-center min-h-full px-4">
              <div className="relative w-full max-w-md">
                <button onClick={closeBuyModal} className="absolute -top-12 right-0 text-white/40 hover:text-white/70 transition-colors">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
                <div className="bg-[#0e0e14] border border-white/[0.06] rounded-3xl overflow-hidden shadow-2xl shadow-black/50">
                  <div className="px-8 pt-8 pb-6 text-center">
                    <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6M10 22h4M12 2v1" /><path d="M12 6a6 6 0 0 0-4 10.5V18h8v-1.5A6 6 0 0 0 12 6z" /></svg>
                    </div>
                    <h2 className="text-xl font-bold text-white mb-1">Add Funds</h2>
                    <p className="text-sm text-white/30">Choose an amount to add to your balance</p>
                  </div>
                  <div className="px-8 pb-6">
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { cents: 200, label: "$2", desc: "1 address", homes: "5 homes" },
                        { cents: 500, label: "$5", desc: "2 addresses", homes: "10 homes" },
                        { cents: 1000, label: "$10", desc: "5 addresses", homes: "25 homes" },
                        { cents: 2500, label: "$25", desc: "12 addresses", homes: "60 homes" },
                      ].map(({ cents, label, desc, homes }) => (
                        <button
                          key={cents}
                          onClick={() => setBuyAmount(cents)}
                          className={`relative py-4 px-4 rounded-2xl text-left transition-all duration-200 ${
                            buyAmount === cents
                              ? "bg-gradient-to-br from-amber-500/15 to-orange-500/10 border-2 border-amber-500/40 shadow-lg shadow-amber-500/5"
                              : "bg-white/[0.02] border-2 border-white/[0.04] hover:bg-white/[0.05] hover:border-white/[0.08]"
                          }`}
                        >
                          {buyAmount === cents && (
                            <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                            </div>
                          )}
                          <div className={`text-2xl font-bold mb-1 ${buyAmount === cents ? "text-amber-300" : "text-white/60"}`}>{label}</div>
                          <div className={`text-xs ${buyAmount === cents ? "text-amber-400/60" : "text-white/20"}`}>{desc}</div>
                          <div className={`text-[10px] mt-0.5 ${buyAmount === cents ? "text-amber-400/35" : "text-white/10"}`}>{homes}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mx-8 mb-6 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/25">All 5 neighbors</span>
                      <span className="text-white/40 font-medium">$2.00</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-1.5">
                      <span className="text-white/25">Single home</span>
                      <span className="text-white/40 font-medium">$0.50</span>
                    </div>
                  </div>
                  <div className="px-8 pb-8">
                    <button
                      onClick={handleBuyCredits}
                      disabled={buyLoading}
                      className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold rounded-xl hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 transition-all shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30"
                    >
                      {buyLoading ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Loading...
                        </span>
                      ) : (
                        `Continue \u2014 $${(buyAmount / 100).toFixed(2)}`
                      )}
                    </button>
                    <div className="flex items-center justify-center gap-2 mt-4">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/10"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                      <p className="text-[11px] text-white/15">Secure payment via Stripe</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
