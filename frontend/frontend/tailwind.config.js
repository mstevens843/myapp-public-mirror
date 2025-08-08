// tailwind.config.js
export default {
    darkMode: ["class"],
    content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
  	extend: {
  		colors: {
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			danger: '#ef4444',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		},
		animation: {
    'fade-in': 'fadeIn 0.4s ease-in-out',
	'flash-glow': 'flashGlow 1s ease-in-out forwards',
	'ping-slow': 'pingSlow 2.2s cubic-bezier(0, 0, 0.2, 1) infinite',

  },  keyframes: {
    fadeIn: {
      from: { opacity: '0' },
      to: { opacity: '1' },
    },
	pingSlow: {
  '0%':   { transform: 'scale(1)',   opacity: '0.8' },
  '70%':  { transform: 'scale(2.8)', opacity: '0' },
  '100%': { transform: 'scale(3.1)', opacity: '0' },
},
	flashGlow: {
  '0%':   { boxShadow: '0 0 0px 0 #10b98100' },
  '50%':  { boxShadow: '0 0 12px 3px #10b981dd' },
  '100%': { boxShadow: '0 0 0px 0 #10b98100' },
},
  },
  		fontFamily: {
  			sans: [
  				'Inter',
  				'ui-sans-serif',
  				'system-ui'
  			]
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
		ringColor: {
      DEFAULT: "transparent", // or 'none'
    },
  	}
	
  },
  plugins: [require("tailwindcss-animate")],
};
