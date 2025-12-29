interface PickerAPI {
  onSources: (callback: (sources: Array<{ id: string; name: string; thumbnail: string }>) => void) => void;
  selectSource: (sourceId: string) => void;
  cancel: () => void;
}

const pickerAPI = (window as unknown as { pickerAPI: PickerAPI }).pickerAPI;

const sourcesGrid = document.getElementById('sources-grid') as HTMLDivElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;

pickerAPI.onSources((sources) => {
  sourcesGrid.replaceChildren();

  sources.forEach((source) => {
    const item = document.createElement('button');
    item.className = 'source-item';
    item.type = 'button';

    const thumbnail = document.createElement('img');
    thumbnail.className = 'source-thumbnail';
    thumbnail.src = source.thumbnail;
    thumbnail.alt = source.name;

    const name = document.createElement('div');
    name.className = 'source-name';
    name.textContent = source.name;

    item.appendChild(thumbnail);
    item.appendChild(name);

    item.addEventListener('click', () => {
      pickerAPI.selectSource(source.id);
    });

    sourcesGrid.appendChild(item);
  });
});

cancelBtn.addEventListener('click', () => {
  pickerAPI.cancel();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    pickerAPI.cancel();
  }
});
