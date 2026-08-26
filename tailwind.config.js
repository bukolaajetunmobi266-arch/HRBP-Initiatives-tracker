/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          blue: '#0070C0',
          navy: '#223A59',
          teal: '#2E6B8A',
          pale: '#DCEAF7',
          orange: '#D85A30',
        },
      },
    },
  },
  plugins: [],
}
