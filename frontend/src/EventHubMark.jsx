import React from 'react';

/**
 * EventHub — marca C2 aprovada (ícone vetorial em gradiente índigo/ciano).
 * Ticket inclinado, estrela de acesso e arco de experiência.
 * A marca usa SVG inline: mantém nitidez em qualquer densidade de tela.
 */
export default function EventHubMark({size=44}) {
  return <svg width={size} height={size} viewBox="0 0 116 104"
    fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="eh-ticket" x1="12" y1="14" x2="101" y2="75" gradientUnits="userSpaceOnUse">
        <stop stopColor="#3520b4"/>
        <stop offset=".48" stopColor="#1239d8"/>
        <stop offset=".82" stopColor="#0b5fff"/>
        <stop offset="1" stopColor="#00caff"/>
      </linearGradient>
      <linearGradient id="eh-beam" x1="58" y1="55" x2="58" y2="78" gradientUnits="userSpaceOnUse">
        <stop stopColor="#f5fbff" stopOpacity=".9"/>
        <stop offset=".4" stopColor="#00d4ff" stopOpacity=".9"/>
        <stop offset="1" stopColor="#00d4ff" stopOpacity=".1"/>
      </linearGradient>
      <linearGradient id="eh-swoosh" x1="8" y1="92" x2="110" y2="87" gradientUnits="userSpaceOnUse">
        <stop stopColor="#4620d7"/>
        <stop offset=".5" stopColor="#0877ff"/>
        <stop offset="1" stopColor="#00d4ff"/>
      </linearGradient>
    </defs>
    <g transform="rotate(-12 58 47)">
      <path d="M13 20Q13 13 20 13H99Q106 13 106 20V38C99 39 95 43 95 49C95 55 99 59 106 60V69Q106 76 99 76H20Q13 76 13 69V60C20 59 24 55 24 49C24 43 20 39 13 38Z" fill="url(#eh-ticket)"/>
      <path d="M28 28Q28 24 32 24H86" stroke="#a8e9ff" strokeWidth="2.5" strokeLinecap="round" opacity=".9"/>
      <path d="M58 27L63.5 39.3L77 41.2L67.2 50.8L69.6 64.3L58 58L46.4 64.3L48.8 50.8L39 41.2L52.5 39.3Z" fill="#fff"/>
      <path d="M58 55L42 76H82Z" fill="url(#eh-beam)" opacity=".85"/>
    </g>
    <path d="M8 92C38 69 74 68 110 89C77 78 42 81 8 92Z" fill="url(#eh-swoosh)"/>
    <path d="M24 88C52 76 79 78 99 85" stroke="#f8fdff" strokeWidth="3" strokeLinecap="round" opacity=".92"/>
  </svg>;
}
