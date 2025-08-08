import React from "react";

const BotStatusButton = ({ trigger }) => {
  return (
    <div
      onClick={() => window.dispatchEvent(new Event("openBotStatusModal"))}
      className="cursor-pointer"
    >
      {trigger}
    </div>
  );
};

export default BotStatusButton;