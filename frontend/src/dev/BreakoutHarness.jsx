import React, { useState } from 'react';
import BreakoutConfig from '../components/BreakoutConfig';

// A minimal harness for manual testing of BreakoutConfig. It mounts the
// config component with a parent useState and passes through the config and
// setConfig props. Use this harness in your dev environment to simulate
// typing, pasting, and tab switching without the surrounding app.
const BreakoutHarness = () => {
  const [config, setConfig] = useState({});

  return (
    <div className="p-4">
      <BreakoutConfig config={config} setConfig={setConfig} disabled={false} />
      {/* Display current config for debugging */}
      <pre className="mt-4 text-xs text-zinc-400">{JSON.stringify(config, null, 2)}</pre>
    </div>
  );
};

export default BreakoutHarness;