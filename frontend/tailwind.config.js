export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#32753E',
        accent: '#DECDA6',
        app: '#F6F7FB',
      },
      boxShadow: {
        soft: '0 18px 45px rgba(15, 23, 42, 0.08)',
        card: '0 12px 32px rgba(15, 23, 42, 0.06)',
      },
    },
  },
  plugins: [],
};
