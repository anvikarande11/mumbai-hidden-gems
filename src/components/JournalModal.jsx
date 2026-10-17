import { useState, useEffect } from 'react';
import { X, BookOpen, Sparkles, MapPin, CheckCircle2, Award } from 'lucide-react';

export default function JournalModal({ isOpen, onClose, landmarks = [], visitedIds = new Set(), store }) {
  const activeVisitedIds = visitedIds || store?.visitedSet || new Set();
  
  const [notes, setNotes] = useState(() => {
    return localStorage.getItem('mumbai_explorer_journal_notes') || '';
  });
  const [activeTab, setActiveTab] = useState('notes');

  // Close on ESC keypress
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    localStorage.setItem('mumbai_explorer_journal_notes', notes);
  }, [notes]);

  if (!isOpen) return null;

  const totalGems = landmarks.length;
  const discoveredCount = landmarks.filter(l => activeVisitedIds.has(l.id)).length;

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-md p-4 animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-3xl overflow-hidden rounded-3xl border border-slate-300/60 bg-[#fdfbf7] shadow-2xl flex flex-col max-h-[85vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200/80 px-6 py-4 bg-[#f8f5ee]">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-md">
              📖
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900">Mumbai 3D Traveler's Journal</h2>
              <p className="text-xs text-slate-500">Log reflections, track discovered gems, and collect passport stamps.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition"
            aria-label="Close Journal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200/80 bg-[#f4efea] px-6 gap-2 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('notes')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-xl transition ${
              activeTab === 'notes'
                ? 'bg-[#fdfbf7] text-slate-900 border-t border-x border-slate-200/80 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            ✏️ Field Notes & Itinerary
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('visited')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-xl transition ${
              activeTab === 'visited'
                ? 'bg-[#fdfbf7] text-slate-900 border-t border-x border-slate-200/80 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            🎯 Discovered Gems ({discoveredCount}/{totalGems})
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 bg-gradient-to-b from-[#fdfbf7] to-[#f9f6ef]">
          {activeTab === 'notes' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Personal Travel Reflections &amp; Plan
                </label>
                <span className="text-[10px] font-mono text-emerald-600 font-medium">✓ Auto-saved to LocalStorage</span>
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Write your Mumbai journey thoughts, cafe wishlist, sunset viewpoints, or meeting schedules here..."
                className="w-full h-64 p-4 rounded-2xl border border-slate-300/60 bg-white/80 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none shadow-inner leading-relaxed"
              />
            </div>
          )}

          {activeTab === 'visited' && (
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                Your Local Discovery Checklist
              </div>
              {landmarks.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No landmarks loaded yet.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {landmarks.map((landmark) => {
                    const isVisited = activeVisitedIds.has(landmark.id);
                    return (
                      <div
                        key={landmark.id}
                        className={`flex items-center justify-between p-3 rounded-xl border transition ${
                          isVisited
                            ? 'border-emerald-200 bg-emerald-50/50 text-slate-900'
                            : 'border-slate-200 bg-white/60 text-slate-500'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={`text-base ${isVisited ? 'text-emerald-600' : 'text-slate-300'}`}>
                            {isVisited ? '✓' : '○'}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate text-slate-800">{landmark.name}</p>
                            <p className="text-[10px] text-slate-400 truncate">{landmark.area || 'Mumbai'}</p>
                          </div>
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          isVisited ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {isVisited ? 'Discovered' : 'Locked'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200/80 px-6 py-3 bg-[#f8f5ee]">
          <span className="text-xs text-slate-500 font-medium">Mumbai Explorer 3D Journal</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-900 px-5 py-2 text-xs font-semibold text-white shadow-md hover:bg-slate-800 transition"
          >
            Close Journal
          </button>
        </div>

      </div>
    </div>
  );
}