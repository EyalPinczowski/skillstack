import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './styles/index.css';
import { mount } from './bootstrap';

mount(document.getElementById('root')!, import.meta.env);
