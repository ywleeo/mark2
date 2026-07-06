import { wireApp } from './app/wireApp.js';

document.addEventListener('DOMContentLoaded', () => {
    // Apply i18n to static HTML elements before components init
    import('./i18n/applyHtmlLocale.js').then(({ applyHtmlLocale }) => applyHtmlLocale());
    const bootstrap = wireApp();
    void bootstrap.initializeApplication();
});
