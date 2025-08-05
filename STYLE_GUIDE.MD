Style Guide
Tailwind Utility-First Styling for Solana Bot Dashboard

Color Theme
Background: bg-zinc-900 (dark panels), bg-black (console/logs)

Borders: border-zinc-700 and border-zinc-800 for subtle panel/table separation

Text: text-white primary, text-zinc-400 for muted, text-emerald-400 for success, text-red-400 for failure

Accent Colors:

Green (#22c55e, bg-emerald-500) → start buttons, success states, slippage themes

Red (#ef4444, bg-red-500) → stop buttons, errors

Blue (#3b82f6) → portfolio equity curve

Cyan (text-cyan-300) → table headers and labels

Typography
Font: font-sans global via Tailwind base

Headings: text-xl, text-3xl with font-bold

Log console: font-mono, text-sm for terminal-style output

Button Style
Base: px-4 py-2 rounded-md font-semibold text-white

Transitions: transition duration-200 ease-in-out

Start Button: bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-500

Stop Button: bg-red-500 hover:bg-red-600 disabled:bg-zinc-500

Secondary Actions (Reset, Export, Toggle): themed individually with consistent padding/hover states

Form Elements
Inputs/Selects:
bg-zinc-800 border border-zinc-600 text-white px-3 py-2 rounded-md

Focus State:
focus:outline-none focus:ring-2 focus:ring-emerald-400

Checkboxes:
accent-emerald-500 (for custom check highlight)

Component Containers
Each section panel follows the same structure:

@apply bg-zinc-900 p-5 rounded-lg mb-6 shadow-md border border-zinc-700 text-white;

This ensures:

Even spacing

Visual grouping

Dark theme consistency

Table Styling
Header: bg-zinc-800 text-cyan-300 font-semibold border-b border-zinc-700

Row: border-b border-zinc-800 text-white px-2 py-1

No-trades message: text-zinc-400 italic mt-2

Log Console
Background: bg-black

Text: text-green-400 font-mono text-sm

Container: max-h-64 overflow-y-auto for scrollability

Chart Containers
Shared style with .chart-container and .portfolio-chart-container:

Same padding, border, shadow as other panels

Blue or green line colors to match their domain (#3b82f6 vs #22c55e)

Responsiveness
ResponsiveContainer from recharts handles graph scaling

Tables and chart sections are full-width: w-full and table-auto

All buttons, labels, and selects follow mobile-friendly padding

