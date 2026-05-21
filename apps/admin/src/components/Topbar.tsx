import { Fragment } from 'react';
import { Icon } from './Icons';

interface TopbarProps {
  trail: string[];
  onNavTrail: (i: number) => void;
}

export function Topbar({ trail, onNavTrail }: TopbarProps) {
  return (
    <div className="topbar">
      <div className="crumbs">
        {trail.map((crumb, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            {i < trail.length - 1 ? (
              <button className="crumb-link" onClick={() => onNavTrail(i)}>
                {crumb}
              </button>
            ) : (
              <b>{crumb}</b>
            )}
          </Fragment>
        ))}
      </div>
      <div className="topbar-tools">
        <div className="kbar">
          <Icon.Search />
          <span>Search jobs, users, items...</span>
          <span className="kbd">{'\u2318'}K</span>
        </div>
        <span className="status-dot">API &middot; 24ms</span>
      </div>
    </div>
  );
}
