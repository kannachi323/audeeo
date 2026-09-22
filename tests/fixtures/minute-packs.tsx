import {createRoot} from 'react-dom/client';
import {ArrowLeft} from 'lucide-react';
import {MinutePackView} from '../../src/components/MinutePacks';
import {LegalFooter} from '../../src/components/LegalLinks';
import {Button} from '../../src/components/Button';
import logo from '../../assets/audeeo-logo.png';
import '../../src/styles.css';
// Production purchase view; catalog values verified in App Store Connect. No checkout in this visual fixture.
const offers=[{id:'minutes_60',minutes:60,price:'$3.00',productID:'audeeo_minutes_60'},{id:'minutes_180',minutes:180,price:'$8.00',productID:'audeeo_minutes_180'},{id:'minutes_600',minutes:600,price:'$20.00',productID:'audeeo_minutes_600'}] as const;
createRoot(document.getElementById('root')!).render(<main className="desktop-onboarding"><div className="onboarding-content"><section className="desktop-onboarding-card stage-subscription"><Button className="onboarding-back" variant="outline"><ArrowLeft/>Back</Button><header className="onboarding-heading"><img className="desktop-onboarding-logo" src={logo} alt="Audeeo"/><h1>Buy minute packs</h1></header><MinutePackView offers={[...offers]} onBuy={()=>{}}/></section></div><LegalFooter/></main>);
