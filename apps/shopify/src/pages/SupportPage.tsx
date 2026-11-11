import { AppFont } from '../components/AppFont';
import { AppPage } from '../components/AppPage';
import { SupportOptions } from '../components/SupportOptions';

export default function SupportPage() {
  return (
    <AppFont>
      <AppPage title="Support" subtitle="Email us, or use the chat button at the bottom right.">
        <SupportOptions />
      </AppPage>
    </AppFont>
  );
}
