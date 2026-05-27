// Application startup is centralized here so feature modules only declare behavior.
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initNewToolEditors, 100);
    setTimeout(initNewToolEditors2, 150);

    const pageInitMap = {
        ...newToolInitMap,
        ...newToolInitMap2,
        notes: initNotesTool,
    };

    document.querySelectorAll('.nav-item').forEach(item => {
        const page = item.dataset.page;
        if (pageInitMap[page]) {
            item.addEventListener('click', () => {
                setTimeout(pageInitMap[page], 50);
            });
        }
    });

    const colorPicker = document.getElementById('palette-base-color');
    const hexInput = document.getElementById('palette-base-hex');
    if (colorPicker && hexInput) {
        colorPicker.addEventListener('input', (e) => {
            hexInput.value = e.target.value;
        });
        hexInput.addEventListener('input', (e) => {
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
                colorPicker.value = e.target.value;
            }
        });
    }

    setTimeout(checkUpdateOnStartup, 2000);
    startNotesReminderService();
    document.getElementById('btn-check-update')?.addEventListener('click', checkUpdateManually);
});
