
import type {Config} from 'tailwindcss';
import {fontFamily} from 'tailwindcss/defaultTheme';

export default {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      screens: {
        'xs': '475px',
      },
      fontFamily: {
        body: ['var(--font-pt-sans)', 'Work Sans', ...fontFamily.sans],
        headline: ['var(--font-pt-sans)', 'Plus Jakarta Sans', ...fontFamily.sans],
        code: ['monospace'],
        pacifico: ['var(--font-pacifico)', 'Pacifico', 'cursive'],
        display: ['var(--font-pacifico)', 'Pacifico', 'cursive'],
        raleway: ['var(--font-raleway)', 'Raleway', 'sans-serif'],
        editorial: ['var(--font-raleway)', 'Raleway', 'sans-serif'],
        jersey25: ['var(--font-jersey25)', 'Jersey 25', 'sans-serif'],
        brand: ['var(--font-jersey25)', 'Jersey 25', 'sans-serif'],
      },
      colors: {
        'surface-dim': '#101418',
        'surface-container-lowest': '#0b0e13',
        'surface-container-low': '#191c21',
        'surface-container': '#1d2025',
        'surface-container-high': '#272a2f',
        'surface-container-highest': '#32353a',
        'on-surface': '#e1e2e9',
        'on-surface-variant': '#bfcab9',
        'surface-bright': '#36393f',
        'surface-variant': '#32353a',
        'outline': '#899485',
        'outline-variant': '#40493d',
        'primary-fixed-dim': '#82db7e',
        'primary-container': '#4da24e',
        'on-primary-container': '#003207',
        'secondary-container': '#006ec9',
        'on-secondary-container': '#eaf0ff',
        'tertiary-container': '#35a61a',
        'tertiary': '#6edf51',
        'on-tertiary-container': '#053200',
        'error-container': '#93000a',
        'on-error-container': '#ffdad6',
        
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
