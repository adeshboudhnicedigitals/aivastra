import { Modal } from '@shopify/polaris';
import { AppFont } from './AppFont';
import { SupportOptions } from './SupportOptions';

/** Help & Support popup opened from the header. */
export function SupportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Help & Support" size="large">
      <Modal.Section>
        <AppFont>
          <SupportOptions onChat={onClose} />
        </AppFont>
      </Modal.Section>
    </Modal>
  );
}
