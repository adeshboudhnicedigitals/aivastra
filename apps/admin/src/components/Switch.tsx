interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function Switch({ checked, onChange }: SwitchProps) {
  return (
    <span
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    />
  );
}
