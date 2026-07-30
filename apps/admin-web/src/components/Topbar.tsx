import { Fragment, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { SIDEBAR_DRAWER_ID, useSidebarContext } from '../context/SidebarContext';
import { Icon } from './Icons';

interface TopbarProps {
  trail: string[];
  onNavTrail: (i: number) => void;
  theme: 'light' | 'dark' | 'system';
  onToggleTheme: () => void;
}

export function Topbar({ trail, onNavTrail, theme, onToggleTheme }: TopbarProps) {
  const { email, role } = useAuth();
  const { isDrawerMode, isOpen, toggle } = useSidebarContext();
  const emailUser = email ? email.split('@')[0] : 'Admin';
  const initials = emailUser.slice(0, 2).toUpperCase();
  const displayEmail = email ?? '';

  // Restore focus to hamburger button after drawer closes (WAI-ARIA pattern)
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(isOpen);
  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      menuButtonRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  return (
    <div className="topbar">
      {isDrawerMode && (
        <button
          ref={menuButtonRef}
          className="topbar-hamburger"
          type="button"
          onClick={toggle}
          aria-label="Toggle navigation menu"
          aria-expanded={isOpen}
          aria-controls={SIDEBAR_DRAWER_ID}
        >
          <Icon.Menu />
        </button>
      )}
      <div className="crumbs">
        {trail.map((crumb, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumb trail has no stable id
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
        <button
          className="iconbtn"
          onClick={onToggleTheme}
          title={`Theme: ${theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'} (click to cycle)`}
          aria-label={`Theme: ${theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'}; click to cycle`}
        >
          {theme === 'system' ? <Icon.Monitor /> : theme === 'dark' ? <Icon.Moon /> : <Icon.Sun />}
        </button>
        <div className="topbar-user">
          <div className="who">
            <b>{emailUser}</b>
            <span className="role-pill">{role}</span>
          </div>
          <span className="avatar" title={displayEmail}>
            {initials}
          </span>
        </div>
      </div>
    </div>
  );
}
