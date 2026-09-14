<template>
  <div class="advanced-joke-generator">
    <div class="joke-container">
      <h1>🎭 Advanced Joke Generator</h1>
      
      <div class="category-selector">
        <label for="category">Select Joke Type:</label>
        <select v-model="selectedCategory" @change="getJoke" id="category">
          <option value="random">Random</option>
          <option value="general">General</option>
          <option value="programming">Programming</option>
          <option value="knock-knock">Knock Knock</option>
        </select>
      </div>

      <div class="joke-display">
        <p v-if="loading" class="loading">🤔 Fetching a funny joke...</p>
        <div v-else-if="joke" class="joke-box">
          <p class="setup">{{ joke.setup }}</p>
          <p v-if="!showPunchline" class="punchline-hint">👉 Click to reveal punchline</p>
          <p v-else class="punchline">{{ joke.punchline }}</p>
          <button @click="togglePunchline" class="reveal-btn">
            {{ showPunchline ? 'Hide Punchline' : 'Show Punchline' }}
          </button>
        </div>
        <p v-else class="placeholder">Click the button to get started!</p>
      </div>

      <div class="button-group">
        <button 
          @click="getJoke" 
          :disabled="loading"
          class="btn btn-primary"
        >
          {{ loading ? 'Loading...' : '😂 Next Joke' }}
        </button>
        <button 
          @click="copyJoke" 
          v-if="joke"
          class="btn btn-secondary"
        >
          📋 Copy
        </button>
      </div>

      <div v-if="error" class="error-message">
        ⚠️ {{ error }}
      </div>

      <div class="stats">
        <p>Jokes loaded: {{ jokeCount }} | Category: {{ selectedCategory }}</p>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'JokeGeneratorAdvanced',
  data() {
    return {
      joke: null,
      loading: false,
      error: '',
      jokeCount: 0,
      selectedCategory: 'random',
      showPunchline: false
    }
  },
  methods: {
    async getJoke() {
      this.loading = true;
      this.error = '';
      this.joke = null;
      this.showPunchline = false;

      try {
        let url = 'https://official-joke-api.appspot.com/';
        
        if (this.selectedCategory === 'random') {
          url += 'random_joke';
        } else {
          url += `jokes/${this.selectedCategory}/random`;
        }

        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error('Failed to fetch joke');
        }

        const data = await response.json();
        
        // Handle array response for some categories
        this.joke = Array.isArray(data) ? data[0] : data;
        this.jokeCount++;
      } catch (err) {
        this.error = 'Could not fetch a joke. Please try again!';
        console.error('Error fetching joke:', err);
      } finally {
        this.loading = false;
      }
    },
    togglePunchline() {
      this.showPunchline = !this.showPunchline;
    },
    copyJoke() {
      if (this.joke) {
        const fullJoke = `${this.joke.setup}\n${this.joke.punchline}`;
        navigator.clipboard.writeText(fullJoke).then(() => {
          alert('Joke copied! 📋');
        }).catch(() => {
          alert('Failed to copy');
        });
      }
    }
  },
  mounted() {
    this.getJoke();
  }
}
</script>

<style scoped>
.advanced-joke-generator {
  min-height: 100vh;
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  padding: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.joke-container {
  background: white;
  border-radius: 20px;
  padding: 40px;
  box-shadow: 0 15px 50px rgba(0, 0, 0, 0.3);
  max-width: 650px;
  width: 100%;
}

h1 {
  color: #333;
  margin-bottom: 30px;
  text-align: center;
  font-size: 32px;
}

.category-selector {
  margin-bottom: 30px;
  text-align: center;
}

.category-selector label {
  display: block;
  margin-bottom: 10px;
  font-weight: bold;
  color: #555;
}

.category-selector select {
  padding: 10px 15px;
  border: 2px solid #f5576c;
  border-radius: 8px;
  font-size: 16px;
  cursor: pointer;
  background: white;
  transition: all 0.3s ease;
}

.category-selector select:hover {
  border-color: #f093fb;
}

.joke-display {
  min-height: 150px;
  margin: 30px 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.joke-box {
  text-align: center;
  animation: popIn 0.5s ease-out;
}

.setup {
  font-size: 18px;
  color: #333;
  font-weight: 600;
  margin-bottom: 15px;
  line-height: 1.6;
}

.punchline {
  font-size: 18px;
  color: #f5576c;
  font-weight: bold;
  margin-top: 15px;
  animation: reveal 0.5s ease-in;
}

.punchline-hint {
  font-size: 14px;
  color: #999;
  font-style: italic;
  margin-top: 15px;
}

.reveal-btn {
  margin-top: 15px;
  padding: 8px 16px;
  background: #f5576c;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: bold;
  transition: all 0.3s ease;
}

.reveal-btn:hover {
  background: #f093fb;
  transform: scale(1.05);
}

.loading {
  font-size: 16px;
  color: #f5576c;
  font-weight: bold;
  animation: pulse 1.5s ease-in-out infinite;
}

.placeholder {
  font-size: 16px;
  color: #999;
  font-style: italic;
}

.button-group {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 30px 0;
  flex-wrap: wrap;
}

.btn {
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s ease;
}

.btn-primary {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-3px);
  box-shadow: 0 8px 25px rgba(245, 87, 108, 0.4);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background: #f0f0f0;
  color: #333;
}

.btn-secondary:hover {
  background: #e0e0e0;
  transform: translateY(-3px);
}

.error-message {
  background: #ffe0e0;
  border-left: 4px solid #f5576c;
  padding: 15px;
  margin: 20px 0;
  border-radius: 8px;
  color: #c33;
  text-align: center;
}

.stats {
  text-align: center;
  margin-top: 30px;
  font-size: 14px;
  color: #999;
}

@keyframes popIn {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes reveal {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

@media (max-width: 600px) {
  .joke-container {
    padding: 20px;
  }

  h1 {
    font-size: 24px;
  }

  .setup, .punchline {
    font-size: 16px;
  }

  .button-group {
    flex-direction: column;
  }

  .btn {
    width: 100%;
  }
}
</style>