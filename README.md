# Voice Auto-Battler

A single-player, hands-free auto-battler for iPhone, controlled by voice. It's built with Vite, React and TypeScript.

## Play
1. Open the deployed URL in **Safari on iPhone**.
2. Tap **Start voice game** once. iOS requires one tap before it allows speech and the microphone.
3. Allow the microphone and speech recognition prompts.
4. Say "help" to hear the commands.

Example commands: "what's in the shop", "buy slot two", "refresh", "buy experience", "level up",
"place my mage in B2", "move my warrior to A3", "bench my squire", "sell my squire",
"tell me about my team", "scout opponent", "how much gold", "status", "fight", "repeat", "quiet",
"minimal / balanced / detailed", "start timer", "new game".

The board has rows A (front), B and C (back), and columns 1 to 4.

## Develop
```
npm install
npm run dev     # local dev server
npm test        # unit tests (command parser, game rules)
npm run build   # production build into dist/
```

## Code layout
- `src/game/config.ts`: all balance numbers (levels, XP, odds, units, traits). Tweak these first.
- `src/game/engine.ts`: game rules (shop, gold, XP, board, upgrades, rounds).
- `src/game/battle.ts`: automatic battle simulation and synergies.
- `src/game/opponents.ts`: AI opponent strategies and scouting text.
- `src/voice/speech.ts`: text-to-speech queue (priorities, no overlapping speech).
- `src/voice/recognition.ts`: continuous speech recognition with auto-restart and error states.
- `src/voice/commands.ts`: turns spoken phrases into commands.
- `src/App.tsx`: the screen.

## Deploy (Vercel)
Import this GitHub repo at vercel.com/new. Vercel detects Vite automatically: the build command is `npm run build` and the output folder is `dist`. Every push then redeploys.

## Known iOS voice limits
- One tap is needed per session, and again after the page goes to the background or the screen locks. iOS stops the microphone then, and the app shows **Tap to resume listening**.
- The screen must stay on. The app requests a Wake Lock (iOS 16.4+) so the screen doesn't lock on its own.
- The mic pauses while the game speaks, so it doesn't hear itself.
- Speech recognition on iOS uses Apple's servers and needs internet.
