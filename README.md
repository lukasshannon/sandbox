# JSON Navigator

A static, mobile-first web app for GitHub Pages that loads a local JSON file, renders a navigable tree, and lets you edit primitive values directly in the browser.

## Features

- Open local `.json` files without any backend.
- Browse nested arrays and objects with a searchable structure panel.
- Collapse or expand nested branches to stay oriented on mobile screens and large payloads.
- Inspect path, key, and type details for the selected node.
- Edit string, number, and boolean values, then download the updated JSON.
- Responsive layout optimized for phones first and enhanced for larger screens.

## GitHub Pages usage

Because the app is fully static, you can publish this repository directly with GitHub Pages.

1. Push the repository to GitHub.
2. In the repository settings, enable **Pages** and choose the branch/folder that serves the repository root.
3. Visit the published URL and use **Open JSON** to load a file from your device.

## Local preview

Open `index.html` directly in a browser, or run a simple static server such as:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.
