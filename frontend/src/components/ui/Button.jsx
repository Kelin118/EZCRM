export default function Button({ children, variant = 'primary', className = '', type = 'button', ...props }) {
  const variants = {
    primary: 'bg-brand text-white shadow-sm shadow-brand/20 hover:bg-[#286233] hover:shadow-md hover:shadow-brand/25 focus-visible:ring-brand/35',
    secondary: 'border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-brand/25 hover:bg-brand/5 hover:text-brand focus-visible:ring-brand/25',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-300',
    danger: 'bg-red-600 text-white shadow-sm shadow-red-600/15 hover:bg-red-700 focus-visible:ring-red-300',
    accent: 'bg-accent text-slate-900 shadow-sm shadow-accent/30 hover:bg-[#d2bf91] focus-visible:ring-accent/60',
  };

  return (
    <button
      type={type}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:translate-y-0 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
