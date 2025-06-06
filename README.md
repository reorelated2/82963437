# RPS Residential Website

This repository contains the source for **RPS Residential** (also known as *Rocket Property Solutions*), a small static site that allows home owners to submit their property details. Most of the site is static HTML, CSS and JavaScript with a PHP form handler.

## Repository Layout

- `rps 2020.zip` – archive containing the full web site including `index.html`, assets and JavaScript.
- Unpacked files (`index.txt`, `partners.html`, etc.) – additional static pages and resources.
- `mail.php` – PHP script used to email form submissions.
- `.github/workflows/` – GitHub Actions workflows for deployment.

## Building and Running

No build step is required. If you wish to view or modify the site locally:

1. Unzip `rps 2020.zip` which will create a directory `rps 2020/` with all the HTML, CSS and JS files.
2. Serve the directory with any web server. For example:
   ```bash
   unzip rps\ 2020.zip
   php -S localhost:8000 -t "rps 2020"
   ```
3. Visit <http://localhost:8000/index.html> in your browser.

`mail.php` requires PHP 7+ and a configured mail server in order to send emails.

## Deployment

The repository is configured to deploy automatically to GitHub Pages. Whenever changes are pushed to the `main` branch, the workflow defined in `.github/workflows/static.yml` uploads the site and publishes it as a GitHub Pages site.

## Dependencies

The site relies on the following libraries (bundled in the `rps 2020` directory):

- [Bootstrap](https://getbootstrap.com/) – styling and layout.
- [jQuery](https://jquery.com/) – DOM utilities and AJAX requests.
- [Font Awesome](https://fontawesome.com/) – icons.
- Pushnami manifest (`manifest.json`) for notifications.

No external package manager is required; all dependencies are vendored in the repository.

