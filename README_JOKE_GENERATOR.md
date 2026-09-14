# Random Joke Generator 😂

A fun feature that generates random jokes using an external API. Two versions available: basic and advanced.

## Features

### JokeGenerator (Basic)
- Simple, clean interface
- Fetches random jokes from the Official Joke API
- Auto-loads a joke on component mount
- Copy joke to clipboard functionality
- Joke counter
- Loading and error states
- Responsive design

### JokeGeneratorAdvanced
- Category selection (Random, General, Programming, Knock-Knock)
- Reveal/hide punchline feature
- Enhanced UI with animations
- Emoji support
- Copy functionality
- Better visual feedback

## External API Used

**Official Joke API** - https://official-joke-api.appspot.com/

### API Endpoints:
- `GET /random_joke` - Returns a random joke
- `GET /jokes/{category}/random` - Returns a random joke from a specific category
- Categories available: `general`, `programming`, `knock-knock`

### Response Format:
```json
{
  "type": "general",
  "setup": "Why did the chicken cross the road?",
  "punchline": "To get to the other side!",
  "id": 1
}
```

## Installation

### Option 1: Import in your main app or page

```vue
<template>
  <JokeGenerator />
  <!-- or -->
  <JokeGeneratorAdvanced />
</template>

<script>
import JokeGenerator from '@/components/JokeGenerator.vue';
import JokeGeneratorAdvanced from '@/components/JokeGeneratorAdvanced.vue';

export default {
  components: {
    JokeGenerator,
    JokeGeneratorAdvanced
  }
}
</script>
```

### Option 2: Register globally (in main.js)

```javascript
import JokeGenerator from '@/components/JokeGenerator.vue';
import JokeGeneratorAdvanced from '@/components/JokeGeneratorAdvanced.vue';

app.component('JokeGenerator', JokeGenerator);
app.component('JokeGeneratorAdvanced', JokeGeneratorAdvanced);
```

## Usage

```vue
<!-- Basic version -->
<JokeGenerator />

<!-- Advanced version with categories -->
<JokeGeneratorAdvanced />
```

## Browser Support

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- IE11: ⚠️ Requires polyfills for fetch and async/await

## Technologies Used

- Vue 3
- Fetch API (for HTTP requests)
- Clipboard API (for copy functionality)
- CSS3 (animations and gradients)

## Error Handling

Both components include error handling for:
- Network failures
- API unavailability
- Invalid responses

Users can retry fetching jokes if an error occurs.

## Customization

You can easily customize:
- Colors: Modify gradient colors in `<style>` section
- API: Change the `fetch()` URL to use a different joke API
- Button text: Update the labels in the template
- Animation speed: Adjust CSS `transition` and `@keyframes` values

## Future Enhancements

- Joke history/favorites
- Share jokes on social media
- Add more joke sources/APIs
- Joke translation feature
- Dark mode support
- Offline mode with cached jokes

## License

MIT