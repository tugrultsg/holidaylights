"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Neighbor {
  address: string;
  lat: number;
  lng: number;
  streetViewUrl: string;
}

interface GeneratedResult {
  address: string;
  originalUrl: string;
  generatedUrl: string;
}

interface Prediction {
  description: string;
  placeId: string;
}

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("hl_session_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("hl_session_id", id);
  }
  return id;
}

export default function Home() {
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState<Prediction[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [neighbors, setNeighbors] = useState<Neighbor[]>([]);
  const [customerAddress, setCustomerAddress] = useState("");
  const [generating, setGenerating] = useState<Record<number, boolean>>({});
  const [results, setResults] = useState<Record<number, GeneratedResult>>({});
  const [generatingAll, setGeneratingAll] = useState(false);
  const [error, setError] = useState("");
  const [freeUsed, setFreeUsed] = useState(false);
  const [paidCredits, setPaidCredits] = useState(0);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [buyQuantity, setBuyQuantity] = useState(5);
  const [buyLoading, setBuyLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const sessionId = useRef("");

  // Initialize session and check credits
  const fetchCredits = useCallback(async () => {
    if (!sessionId.current) return;
    try {
      const res = await fetch(`/api/credits?sessionId=${sessionId.current}`);
      const data = await res.json();
      setFreeUsed(data.freeUsed);
      setPaidCredits(data.paidCredits);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    sessionId.current = getSessionId();
    fetchCredits();

    // Check for payment success redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success") {
      // Clean URL
      window.history.replaceState({}, "", "/");
      // Refresh credits after a short delay (webhook may take a moment)
      setTimeout(fetchCredits, 2000);
    }
  }, [fetchCredits]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const fetchSuggestions = (query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setSuggestions(data.predictions);
        setShowSuggestions(data.predictions.length > 0);
      } catch {
        setSuggestions([]);
      }
    }, 300);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setAddress(val);
    fetchSuggestions(val);
  };

  const selectSuggestion = (prediction: Prediction) => {
    setAddress(prediction.description);
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCustomerAddress(data.customerAddress);
      setNeighbors(data.neighbors);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const generateLights = async (index: number, neighbor: Neighbor) => {
    setGenerating((prev) => ({ ...prev, [index]: true }));
    setError("");
    try {
      const res = await fetch("/api/generate-lights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: neighbor.streetViewUrl,
          address: neighbor.address,
          sessionId: sessionId.current,
        }),
      });
      const data = await res.json();

      if (data.error === "NO_CREDITS") {
        setShowBuyModal(true);
        return;
      }

      if (!res.ok) throw new Error(data.error || data.message);

      setResults((prev) => ({
        ...prev,
        [index]: data,
      }));
      setFreeUsed(data.freeUsed);
      setPaidCredits(data.credits);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Generation failed";
      setError(message);
    } finally {
      setGenerating((prev) => ({ ...prev, [index]: false }));
    }
  };

  const generateAll = async () => {
    setGeneratingAll(true);
    for (let i = 0; i < neighbors.length; i++) {
      if (!results[i]) {
        await generateLights(i, neighbors[i]);
        // Stop if user ran out of credits
        if (showBuyModal) break;
      }
    }
    setGeneratingAll(false);
  };

  const handleBuyCredits = async () => {
    setBuyLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: buyQuantity,
          sessionId: sessionId.current,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setError("Could not start checkout");
    } finally {
      setBuyLoading(false);
    }
  };

  const completedCount = Object.keys(results).length;
  const availableCredits = freeUsed ? paidCredits : 1 + paidCredits;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white antialiased">
      <div className="fixed inset-0 bg-gradient-to-br from-indigo-950/20 via-transparent to-purple-950/10 pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 border-b border-white/[0.06]">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18h6M10 22h4M12 2v1M4.2 4.2l.7.7M1 12h1M20.8 4.2l-.7.7M22 12h1" />
                    <path d="M12 6a6 6 0 0 0-4 10.5V18h8v-1.5A6 6 0 0 0 12 6z" />
                  </svg>
                </div>
                <h1 className="text-xl font-semibold tracking-tight text-white">
                  Holiday Lights Preview
                </h1>
              </div>
              <p className="text-sm text-white/40 ml-11">
                Visualize professional holiday lighting on neighboring homes
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06]">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span className="text-xs text-white/50">
                  <span className="text-white/80 font-medium">{availableCredits}</span> {availableCredits === 1 ? "credit" : "credits"}
                </span>
              </div>
              <button
                onClick={() => setShowBuyModal(true)}
                className="px-3 py-1.5 text-xs font-medium rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-400 hover:to-orange-400 transition-all"
              >
                Buy Credits
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-5xl mx-auto px-6 py-10">
        {/* Search */}
        <div className="mb-12">
          <div className="flex gap-2">
            <div className="relative flex-1" ref={wrapperRef}>
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </div>
              <input
                type="text"
                value={address}
                onChange={handleInputChange}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                onKeyDown={(e) => e.key === "Enter" && findNeighbors()}
                placeholder="Enter an address to get started..."
                className="w-full pl-11 pr-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all"
              />
              {showSuggestions && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-[#16161f] border border-white/[0.08] rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50">
                  {suggestions.map((prediction, i) => (
                    <button
                      key={prediction.placeId}
                      onClick={() => selectSuggestion(prediction)}
                      className={`w-full text-left px-4 py-3 text-sm hover:bg-white/[0.04] transition-colors flex items-center gap-3 ${
                        i > 0 ? "border-t border-white/[0.04]" : ""
                      }`}
                    >
                      <span className="text-white/20">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                      </span>
                      <span>
                        <span className="text-white/80 font-medium">
                          {prediction.description.split(",")[0]}
                        </span>
                        <span className="text-white/30">
                          ,{prediction.description.split(",").slice(1).join(",")}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={findNeighbors}
              disabled={loading || !address.trim()}
              className="px-6 py-3.5 bg-white text-black text-sm font-medium rounded-xl hover:bg-white/90 disabled:bg-white/10 disabled:text-white/20 transition-all whitespace-nowrap"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                  Searching
                </span>
              ) : (
                "Find Neighbors"
              )}
            </button>
          </div>
          {error && (
            <p className="mt-3 text-red-400/80 text-sm">{error}</p>
          )}
        </div>

        {/* First generation free banner */}
        {!freeUsed && neighbors.length > 0 && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <p className="text-sm text-emerald-300/80">
              Your first generation is <span className="font-semibold text-emerald-300">free</span> — try it out!
            </p>
          </div>
        )}

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
              {completedCount > 0 && (
                <span className="text-xs text-white/30">
                  {completedCount}/{neighbors.length} generated
                </span>
              )}
              {neighbors.length > 0 && (
                <button
                  onClick={generateAll}
                  disabled={generatingAll || completedCount === neighbors.length}
                  className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-semibold rounded-lg hover:from-amber-400 hover:to-orange-400 disabled:from-white/10 disabled:to-white/10 disabled:text-white/30 transition-all"
                >
                  {generatingAll ? (
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Generating...
                    </span>
                  ) : completedCount === neighbors.length ? (
                    "All Done"
                  ) : (
                    "Generate All"
                  )}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Neighbors grid */}
        <div className="space-y-4">
          {neighbors.map((neighbor, index) => (
            <div
              key={index}
              className="group rounded-2xl overflow-hidden bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.1] transition-all"
            >
              <div className="px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-bold text-white/40">
                    {index + 1}
                  </span>
                  <span className="text-sm text-white/60">{neighbor.address}</span>
                </div>
                {!results[index] && (
                  <button
                    onClick={() => generateLights(index, neighbor)}
                    disabled={generating[index]}
                    className="px-4 py-1.5 text-xs font-medium rounded-lg bg-white/[0.06] text-white/60 hover:bg-white/[0.1] hover:text-white/80 disabled:opacity-50 transition-all"
                  >
                    {generating[index] ? (
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 border-2 border-white/20 border-t-amber-400 rounded-full animate-spin" />
                        Generating...
                      </span>
                    ) : (
                      "Add Lights"
                    )}
                  </button>
                )}
                {results[index] && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400/70">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Done
                  </span>
                )}
              </div>

              <div className="grid md:grid-cols-2">
                <div className="relative">
                  <div className="absolute top-3 left-3 z-10">
                    <span className="px-2.5 py-1 text-[10px] uppercase tracking-widest font-semibold bg-black/50 text-white/60 rounded-md backdrop-blur-md">
                      Before
                    </span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={neighbor.streetViewUrl}
                    alt={`Street view of ${neighbor.address}`}
                    className="w-full h-72 object-cover"
                  />
                </div>

                <div className="relative">
                  {results[index] ? (
                    <>
                      <div className="absolute top-3 left-3 z-10">
                        <span className="px-2.5 py-1 text-[10px] uppercase tracking-widest font-semibold bg-amber-500/80 text-white rounded-md backdrop-blur-md">
                          After
                        </span>
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={results[index].generatedUrl}
                        alt={`${neighbor.address} with holiday lights`}
                        className="w-full h-72 object-cover"
                      />
                    </>
                  ) : generating[index] ? (
                    <div className="flex items-center justify-center h-72 bg-white/[0.02]">
                      <div className="text-center">
                        <div className="relative w-10 h-10 mx-auto mb-3">
                          <div className="absolute inset-0 rounded-full border-2 border-white/[0.06]" />
                          <div className="absolute inset-0 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
                        </div>
                        <p className="text-xs text-white/30">Adding holiday lights...</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-72 bg-white/[0.02]">
                      <div className="text-center">
                        <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-white/[0.04] flex items-center justify-center">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/15">
                            <path d="M9 18h6M10 22h4M12 2v1" />
                            <path d="M12 6a6 6 0 0 0-4 10.5V18h8v-1.5A6 6 0 0 0 12 6z" />
                          </svg>
                        </div>
                        <p className="text-xs text-white/20">Preview will appear here</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty state */}
        {!loading && neighbors.length === 0 && !customerAddress && (
          <div className="text-center py-24">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/15">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <p className="text-sm text-white/25">Enter an address above to find nearby homes</p>
          </div>
        )}

        {!loading && neighbors.length === 0 && customerAddress && (
          <div className="text-center py-24">
            <p className="text-sm text-white/25">No neighbors found for this address. Try a different one.</p>
          </div>
        )}
      </main>

      {/* Buy Credits Modal */}
      {showBuyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowBuyModal(false)}
          />
          <div className="relative bg-[#12121a] border border-white/[0.08] rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl">
            <button
              onClick={() => setShowBuyModal(false)}
              className="absolute top-4 right-4 text-white/30 hover:text-white/60 transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>

            <div className="text-center mb-6">
              <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-gradient-to-br from-amber-400/20 to-orange-500/20 border border-amber-500/20 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-400">
                  <path d="M9 18h6M10 22h4M12 2v1" />
                  <path d="M12 6a6 6 0 0 0-4 10.5V18h8v-1.5A6 6 0 0 0 12 6z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-white mb-1">Buy Generation Credits</h2>
              <p className="text-sm text-white/40">$2 per generation</p>
            </div>

            {/* Quantity selector */}
            <div className="mb-6">
              <div className="grid grid-cols-4 gap-2">
                {[1, 5, 10, 25].map((qty) => (
                  <button
                    key={qty}
                    onClick={() => setBuyQuantity(qty)}
                    className={`py-3 rounded-xl text-center transition-all ${
                      buyQuantity === qty
                        ? "bg-amber-500/20 border border-amber-500/40 text-amber-300"
                        : "bg-white/[0.04] border border-white/[0.06] text-white/50 hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="text-lg font-bold">{qty}</div>
                    <div className="text-[10px] text-white/30">${qty * 2}</div>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleBuyCredits}
              disabled={buyLoading}
              className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold rounded-xl hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 transition-all"
            >
              {buyLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Redirecting to checkout...
                </span>
              ) : (
                `Pay $${buyQuantity * 2} for ${buyQuantity} credit${buyQuantity > 1 ? "s" : ""}`
              )}
            </button>

            <p className="text-[11px] text-white/20 text-center mt-4">
              Secure payment via Stripe
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
