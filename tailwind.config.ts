/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        'np-blue': '#476B8E',
        'np-blue-light': '#5a7fa3',
        'np-blue-dark': '#3a5875',
        'np-teal': '#2A9D8F',
        'np-gold': '#E9C46A',
        'np-coral': '#F4A261',
        'np-terra': '#E76F51',
        'np-sage': '#52B788',
        'np-dark': '#1E293B',
        'np-gray': '#64748B',
        'np-light': '#F8FAFB',
      },
      fontFamily: {
        display: ['Cormorant Garamond', 'serif'],
        body: ['Outfit', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
