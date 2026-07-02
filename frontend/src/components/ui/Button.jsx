export default function Button({ children, variant = 'primary', className = '', type = 'button', ...props }) {
  const variants = {
    primary: 'bg-brand text-white shadow-sm shadow-brand/20 hover:bg-[#286233] hover:shadow-md hover:shadow-brand/25',
    secondary: 'border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-brand/25 hover:bg-brand/5 hover:text-brand',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
    danger: 'bg-red-600 text-white shadow-sm shadow-red-600/15 hover:bg-red-700',
    accent: 'bg-accent text-slate-900 shadow-sm shadow-accent/30 hover:bg-[#d2bf91]',
  };

  return (
    <button
      type={type}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
