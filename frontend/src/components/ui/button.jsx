import React from "react";
import classNames from "classnames"; // optional: use if you want utility merging

export const Button = ({ children, className = "", ...props }) => {
  return (
    <button
      className={classNames("px-3 py-2 rounded  text-white", className)}
      {...props}
    >
      {children}
    </button>
  );
};
