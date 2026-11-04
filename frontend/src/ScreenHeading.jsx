import React from 'react';

/** Reusable editorial heading for all authenticated EventHub screens. */
export default function ScreenHeading({eyebrow,title,description,actions}){
  return <header className="eh-screen-heading">
    <div className="eh-screen-heading-copy">
      <span className="eh-screen-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {description&&<p>{description}</p>}
    </div>
    {actions&&<div className="eh-screen-actions">{actions}</div>}
  </header>;
}
