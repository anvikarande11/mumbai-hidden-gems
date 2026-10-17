import { useEffect, useState } from 'react';
import { ArrowRight, Compass, Eye, EyeOff, LockKeyhole, Mail, X } from 'lucide-react';

const CSS = `
@keyframes auth-rise { from { opacity: 0; transform: translateY(18px) scale(.98) } to { opacity: 1; transform: translateY(0) scale(1) } }
@keyframes auth-flip { from { transform: rotateY(0deg) } to { transform: rotateY(180deg) } }
.auth-rise { animation: auth-rise .45s cubic-bezier(.2,.75,.2,1) both }
.auth-scene { perspective: 1600px }
.auth-card { transform-style: preserve-3d; transition: transform .75s cubic-bezier(.2,.75,.2,1) }
.auth-card.is-flipped { transform: rotateY(180deg) }
.auth-face { backface-visibility: hidden; -webkit-backface-visibility: hidden }
.auth-back { transform: rotateY(180deg) }
@media (prefers-reduced-motion: reduce) { .auth-card { transition: none } .auth-rise { animation: none } }
`;

export default function AuthModal({ isOpen, onClose, onSignedIn }) {
  const [flipped, setFlipped] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const submit = (event) => {
    event.preventDefault();
    onSignedIn?.({ email: email || 'traveler@mumbaigems.app' });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#17212b]/55 p-4 backdrop-blur-md" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <style>{CSS}</style>
      <div className="auth-rise auth-scene w-full max-w-[430px]">
        <div className={`auth-card relative min-h-[570px] ${flipped ? 'is-flipped' : ''}`}>
          {[{ title: 'Welcome back, traveler', eyebrow: 'Continue your atlas', copy: 'Pick up where your Mumbai story left off.', action: 'Sign in', switchText: 'New to the expedition?', switchAction: 'Create an account' }, { title: 'Join the expedition', eyebrow: 'Make the city yours', copy: 'Save preferences, itineraries, and every hidden gem.', action: 'Create account', switchText: 'Already exploring?', switchAction: 'Sign in' }].map((face, index) => (
            <section key={face.title} className={`auth-face absolute inset-0 flex flex-col overflow-hidden rounded-[30px] border border-white/60 bg-[#fdfbf7]/95 p-7 shadow-[0_30px_90px_rgba(15,23,42,.28)] ${index === 1 ? 'auth-back' : ''}`} aria-hidden={index === 0 ? flipped : !flipped}>
              <div className="absolute -right-20 -top-20 size-52 rounded-full bg-[#e8d5b5]/40 blur-2xl" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-slate-500"><span className="flex size-8 items-center justify-center rounded-xl bg-slate-900 text-[#fdfbf7]"><Compass className="size-4" /></span> Mumbai Gems</div>
                <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-800" aria-label="Close authentication"><X className="size-4" /></button>
              </div>
              <div className="relative mt-auto">
                <p className="text-[10px] font-semibold uppercase tracking-[.22em] text-[#a16c4d]">{face.eyebrow}</p>
                <h2 className="mt-3 max-w-[320px] font-serif text-4xl leading-[.98] tracking-[-.04em] text-slate-900">{face.title}</h2>
                <p className="mt-4 max-w-[310px] text-sm leading-6 text-slate-500">{face.copy}</p>
                <form onSubmit={submit} className="mt-7 flex flex-col gap-3">
                  <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/75 px-4 py-3 focus-within:border-slate-500"><Mail className="size-4 text-slate-400" /><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400" /></label>
                  <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/75 px-4 py-3 focus-within:border-slate-500"><LockKeyhole className="size-4 text-slate-400" /><input required minLength={6} type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="text-slate-400" aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></label>
                  <button type="submit" className="group mt-1 flex items-center justify-between rounded-2xl bg-slate-900 px-5 py-4 text-sm font-semibold text-white transition hover:bg-[#a16c4d]">{face.action}<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></button>
                </form>
                <button type="button" onClick={() => setFlipped((value) => !value)} className="mt-5 text-xs text-slate-500 underline decoration-slate-300 underline-offset-4 transition hover:text-slate-900">{face.switchText} <span className="font-semibold text-slate-800">{face.switchAction}</span></button>
              </div>
              <div className="relative mt-7 flex items-center justify-between border-t border-slate-200/80 pt-4 text-[10px] uppercase tracking-[.16em] text-slate-400"><span>Private field notes</span><span>01 / 02</span></div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
