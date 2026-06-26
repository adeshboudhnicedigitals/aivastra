interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
}

export default function TryonPage(_props: Props) {
  return <div style={{ padding: 24 }}>Tryon</div>;
}
