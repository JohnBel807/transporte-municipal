import colors from 'tailwindcss/colors'

// Colores que cambian con el tema (variables CSS definidas en src/index.css)
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: {
          50: v('slate-50'), 100: v('slate-100'), 200: v('slate-200'), 300: v('slate-300'),
          400: v('slate-400'), 500: v('slate-500'), 600: v('slate-600'), 700: v('slate-700'),
          800: v('slate-800'), 900: v('slate-900'), 950: v('slate-950'),
        },
        teal:  { ...colors.teal,  300: v('teal-300'),  400: v('teal-400'),  500: v('teal-500') },
        red:   { ...colors.red,   300: v('red-300'),   400: v('red-400'),   500: v('red-500') },
        amber: { ...colors.amber, 400: v('amber-400'), 500: v('amber-500') },
      },
    },
  },
  plugins: [],
}