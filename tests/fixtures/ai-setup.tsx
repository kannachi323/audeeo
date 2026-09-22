import React from 'react';
import {createRoot} from 'react-dom/client';
import {AIConsentSetup} from '../../src/components/AIConsent';
import '../../src/styles.css';
// Local visual fixture; no capture, account access, or provider requests.
createRoot(document.getElementById('root')!).render(<div style={{width:720,height:800}}><AIConsentSetup owner="visual-fixture" user={{id:"visual-fixture",app_metadata:{provider:"google"}} as any} onContinue={()=>{}} onSignOut={()=>{}}/></div>);
