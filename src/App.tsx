/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import GameCanvas from './components/GameCanvas';

export default function App() {
  return (
    <div className="w-screen h-screen overflow-hidden bg-[#0d0f1b] font-sans selection:bg-none">
      <GameCanvas />
    </div>
  );
}
