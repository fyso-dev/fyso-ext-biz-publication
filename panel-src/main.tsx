import { mountExtensionPage } from '@fyso/panel';
import { Identity } from './Identity';
import es from './locales/es.json';
import en from './locales/en.json';
import './style.css';
void mountExtensionPage(Identity, { es, en });
