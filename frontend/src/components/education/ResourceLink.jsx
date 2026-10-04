/**
 * A learning-resource card's link. An entry that carries `to` is a page on
 * this site and is routed; one that carries `url` is external and opens in
 * a new tab. `resourceCta` gives the matching call to action, so a page
 * reads the entry once and never branches on it in its markup.
 */
import React from 'react';
import { Link } from 'react-router';

const OPEN_HERE = Object.freeze({ label: 'Open', icon: 'arrow_forward' });
const EXPLORE_THERE = Object.freeze({ label: 'Explore', icon: 'open_in_new' });

/** The footer word and icon for a resource card: "Open" here, "Explore" elsewhere. */
export function resourceCta(resource) {
  return resource.to ? OPEN_HERE : EXPLORE_THERE;
}

export default function ResourceLink({ resource, className, children }) {
  if (resource.to) {
    return (
      <Link to={resource.to} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={resource.url} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}
