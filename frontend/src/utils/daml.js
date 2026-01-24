export function normalizeDamlMap(value) {
  if (!value) return {};

  const extractEntries = (entries) => {
    const obj = {};
    for (const entry of entries) {
      if (Array.isArray(entry) && entry.length >= 2) {
        obj[entry[0]] = entry[1];
        continue;
      }
      if (entry && typeof entry === 'object' && 'key' in entry && 'value' in entry) {
        obj[entry.key] = entry.value;
      }
    }
    return obj;
  };

  if (Array.isArray(value)) {
    return extractEntries(value);
  }

  if (value && typeof value === 'object') {
    if (Array.isArray(value.map)) {
      return extractEntries(value.map);
    }
    if (Array.isArray(value.entries)) {
      return extractEntries(value.entries);
    }
    return { ...value };
  }

  return {};
}
