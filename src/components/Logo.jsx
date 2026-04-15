import React from 'react';

export default function Logo({ size = 30 }) {
  return <img src="/logo.png" alt="Ether" 
    style={{ width:size, height:size, borderRadius:size*0.23, display:'block' }}/>;
}