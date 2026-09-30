# Поддержать меня — Bitcoin

Статическая страница с адресом для доната: `bc1qx4wlpqvlp46rf25w7vlej267ux6k0k8dl775gm`
Рекомендуемая сумма: **0.0005 BTC**.

## Что внутри
- `index.html` — разметка страницы
- `style.css` — тёмная тема, адаптив
- `app.js` — QR-код (BIP-21), копирование адреса, курс BTC/USD

## Локальный запуск
```bash
python3 -m http.server 8000
# открыть http://localhost:8000
```

## GitHub Pages
Репозиторий уже настроен: **Settings → Pages → Source: GitHub Actions**.
После пуша сайт доступен по адресу:
`https://timatigoogl3-code.github.io/donate-btc/`

## Как отправить
Только сеть **Bitcoin mainnet**. QR и кнопка «Открыть кошелёк» используют BIP-21,
поэтому сумма подставляется автоматически.
