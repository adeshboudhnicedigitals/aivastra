export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        background: '#18121F',
        color: '#fff',
        fontSize: '13.5px',
        fontWeight: 500,
        padding: '12px 18px',
        borderRadius: '12px',
        boxShadow: '0 12px 28px rgba(0,0,0,0.24)',
        zIndex: 40,
      }}
    >
      {message}
    </div>
  );
}
