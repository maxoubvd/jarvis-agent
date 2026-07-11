<script lang="ts" module>
  // Icônes trait 16×16 dessinées à la main (stroke currentColor), style
  // feather/lucide — remplace les emojis pour un rendu homogène.
  const CIRCLE = 'M13.5 8A5.5 5.5 0 1 1 2.5 8a5.5 5.5 0 0 1 11 0Z';

  const PATHS: Record<string, string> = {
    chat: 'M13.5 4.5v6a1 1 0 0 1-1 1H8.2L5 14v-2.5H3.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1Z',
    history: `${CIRCLE}M8 5v3.3l2.2 1.3`,
    graph: 'M3.5 13.5V9.5M8 13.5V4.5M12.5 13.5V7.5',
    gear: 'M2 4.5h6.5M11.5 4.5H14M2 11.5h1.5M6.5 11.5H14M11.5 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM6.5 11.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z',
    menu: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11',
    close: 'm4 4 8 8m0-8-8 8',
    add: 'M8 3v10M3 8h10',
    trash: 'M3 4.5h10M6.3 4.5V3h3.4v1.5M4.5 4.5l.5 9h6l.5-9',
    'chevron-up': 'm4 10 4-4 4 4',
    'chevron-down': 'm4 6 4 4 4-4',
    check: 'm3 8.5 3.5 3.5L13 5',
    error: `${CIRCLE}m6 6 4 4m0-4-4 4`,
    warning: 'M8 2.7 14.3 13.3H1.7L8 2.7ZM8 7v2.8M8 11.6v.01',
    info: `${CIRCLE}M8 7.3V11M8 5.3v.01`,
    tools:
      'M13.4 4.7a3.4 3.4 0 0 1-4.5 4.5l-4.2 4.2-2.1-2.1 4.2-4.2a3.4 3.4 0 0 1 4.5-4.5L9.2 4.7l2.1 2.1 2.1-2.1Z',
    lightbulb:
      'M6.4 11.2c0-1.8-2.4-2.5-2.4-5.2a4 4 0 0 1 8 0c0 2.7-2.4 3.4-2.4 5.2h-3.2ZM6.8 13.7h2.4',
    book: 'M12.5 14H5a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 5 1.5h7.5V11H5a1.5 1.5 0 0 0 0 3Z',
    folder:
      'M1.5 12.5v-8a1 1 0 0 1 1-1H6l1.5 2h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1Z',
    server:
      'M2.5 2.5h11a1 1 0 0 1 1 1V6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1ZM2.5 9h11a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1ZM4.3 4.75h.01M4.3 11.25h.01',
    sync: 'M13.5 2.5V6H10M2.5 13.5V10H6M13.1 6A5.5 5.5 0 0 0 3.9 3.9L2.5 5.2M2.9 10a5.5 5.5 0 0 0 9.2 2.1l1.4-1.3',
    globe: `${CIRCLE}M2.5 8h11M8 2.5c-1.7 1.5-2.6 3.4-2.6 5.5s.9 4 2.6 5.5c1.7-1.5 2.6-3.4 2.6-5.5S9.7 4 8 2.5Z`,
    send: 'M14 2 7.3 8.7M14 2 9.4 13.7 7.3 8.7 2.3 6.6 14 2Z',
    edit: 'M10.5 2.5 13.5 5.5 5.7 13.3 2.3 13.7 2.7 10.3 10.5 2.5Z M9.3 3.7 12.3 6.7',
    cpu: 'M5 5h6v6H5Z M2.3 6.5h2M2.3 9.5h2M11.7 6.5h2M11.7 9.5h2M6.5 2.3v2M9.5 2.3v2M6.5 11.7v2M9.5 11.7v2',
    square: 'M3.5 3.5h9v9h-9Z'
  };
</script>

<script lang="ts">
  interface Props {
    name: string;
    size?: number;
  }

  let { name, size = 16 }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.3"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={PATHS[name] ?? CIRCLE} />
</svg>

<style>
  svg {
    flex-shrink: 0;
    vertical-align: -3px;
  }
</style>