// A websocket rock-paper-scissors game server

const WebSocket = require("ws")
const http = require("http")

const server = http.createServer()
const wss = new WebSocket.Server({ server })

let tournamentInProgress = false

let playerIdCounter = 1

let playerList = []
let startTimer = null // wait 5 seconds after the last player joins before starting the game

let currentGames = [] // list of player ids currently in active matches
let currentPlayerGame = {} // map playerId -> game object

let bracket = {}
let tournamentWinners = []

function createBracket(players) {
  if (players.length === 1) {
    return players[0]
  }
  const mid = Math.floor(players.length / 2)
  return {
    left: createBracket(players.slice(0, mid)),
    right: createBracket(players.slice(mid)),
  }
}

wss.on("connection", (ws) => {
  console.log("New player connected")

  ws.on("message", (message) => {
    const data = JSON.parse(message)

    if (data.type === "join") {
      if (tournamentInProgress) {
        ws.send(JSON.stringify({ type: "error", message: "Tournament is already in progress." }))
        ws.close()
        return
      }
      playerList.push({ ws: ws, id: playerIdCounter++ })
      broadcastPlayerCount()
      resetStartTimer()
    } else if (data.type === "choice") {
      const player = playerList.find((p) => p.ws === ws)
      if (player) {
        if (!currentGames.includes(player.id)) {
          ws.send(JSON.stringify({ type: "error", message: "You are not in a match." }))
          return
        }
        const game = currentPlayerGame[player.id]
        if (!game) {
          ws.send(JSON.stringify({ type: "error", message: "Game not found." }))
          return
        }
        if (game.choices[player.id]) {
          ws.send(JSON.stringify({ type: "error", message: "You have already made your choice." }))
          return
        }
        game.choices[player.id] = data.choice
        checkGameResult(game)
      }
    }
  })

  ws.on("close", () => {
    console.log("Player disconnected")
    // Remove from player list
    const disconnected = playerList.find((p) => p.ws === ws)
    playerList = playerList.filter((p) => p.ws !== ws)
    broadcastPlayerCount()
    // If player was in an active game, award win to opponent
    if (disconnected && currentPlayerGame[disconnected.id]) {
      const game = currentPlayerGame[disconnected.id]
      const opponentId = game.players.find((id) => id !== disconnected.id)
      const opponent = playerList.find((p) => p.id === opponentId)
      if (opponent) {
        opponent.ws.send(
          JSON.stringify({
            type: "gameResult",
            result: "win",
            yourChoice: game.choices[opponentId] || null,
            opponentChoice: null,
            note: "opponent_disconnected",
          })
        )
      }
      // clean up
      currentGames = currentGames.filter((id) => id !== game.players[0] && id !== game.players[1])
      delete currentPlayerGame[game.players[0]]
      delete currentPlayerGame[game.players[1]]
      //   TODO - maybeFinishTournament()
    }
    resetStartTimer()
  })
})

function broadcastPlayerCount() {
  const message = JSON.stringify({ type: "playerCount", count: playerList.length })
  playerList.forEach((player) => {
    player.ws.send(message)
  })
}

function resetStartTimer() {
  if (startTimer) {
    clearTimeout(startTimer)
  }
  if (playerList.length >= 2) {
    startTimer = setTimeout(startTourney, 5000)
  }
}

function startMatch(player1, player2) {
  // Start a single match between two players
  const game = {
    players: [player1.id, player2.id],
    choices: {},
  }
  currentGames.push(player1.id, player2.id)
  currentPlayerGame[player1.id] = game
  currentPlayerGame[player2.id] = game

  player1.ws.send(JSON.stringify({ type: "matchStart", opponentId: player2.id }))
  player2.ws.send(JSON.stringify({ type: "matchStart", opponentId: player1.id }))
}

function startTourney() {
  // Start one round of a single-elimination tournament
  console.log("Starting tournament")
  const shuffledPlayers = [...playerList].sort(() => 0.5 - Math.random())
  bracket = createBracket(shuffledPlayers.map((p) => p.id))
  tournamentInProgress = true

  // Notify clients tournament is starting
  playerList.forEach((p) =>
    p.ws.send(JSON.stringify({ type: "tournamentStart", players: shuffledPlayers.map((x) => x.id) }))
  )

  for (let i = 0; i < shuffledPlayers.length; i += 2) {
    if (i + 1 < shuffledPlayers.length) {
      const player1 = shuffledPlayers[i]
      const player2 = shuffledPlayers[i + 1]
      const game = {
        players: [player1.id, player2.id],
        choices: {},
      }
      currentGames.push(player1.id, player2.id)
      currentPlayerGame[player1.id] = game
      currentPlayerGame[player2.id] = game

      player1.ws.send(JSON.stringify({ type: "matchStart", opponentId: player2.id }))
      player2.ws.send(JSON.stringify({ type: "matchStart", opponentId: player1.id }))
    } else {
      // odd player => bye to next round (they automatically win this round)
      const byePlayer = shuffledPlayers[i]
      tournamentWinners.push(byePlayer.id)
      byePlayer.ws.send(JSON.stringify({ type: "matchBye", message: "You received a bye and advance to next round." }))
    }
  }
}

function checkGameResult(game) {
  if (Object.keys(game.choices).length < 2) {
    return // wait for both players to make a choice
  }
  const [player1Id, player2Id] = game.players
  const choice1 = game.choices[player1Id]
  const choice2 = game.choices[player2Id]

  // Resolve player objects early so they're available for tie-breaks
  const player1 = playerList.find((p) => p.id === player1Id)
  const player2 = playerList.find((p) => p.id === player2Id)

  let winnerId = null
  let loserId = null

  if (choice1 === choice2) {
    // send tie break message (only if players still connected)
    if (player1) {
      player1.ws.send(JSON.stringify({ type: "tieBreak", opponentChoice: choice2 }))
    }
    if (player2) {
      player2.ws.send(JSON.stringify({ type: "tieBreak", opponentChoice: choice1 }))
    }
    game.choices = {} // reset choices for tie break
    return
  } else if (
    (choice1 === "rock" && choice2 === "scissors") ||
    (choice1 === "scissors" && choice2 === "paper") ||
    (choice1 === "paper" && choice2 === "rock")
  ) {
    winnerId = player1Id
    loserId = player2Id
  } else {
    winnerId = player2Id
    loserId = player1Id
  }
  if (player1) {
    player1.ws.send(
      JSON.stringify({
        type: "matchResult",
        result: winnerId === player1Id ? "win" : "lose",
        yourChoice: choice1,
        opponentChoice: choice2,
      })
    )
  }
  if (player2) {
    player2.ws.send(
      JSON.stringify({
        type: "matchResult",
        result: winnerId === player2Id ? "win" : "lose",
        yourChoice: choice2,
        opponentChoice: choice1,
      })
    )
  }

  //   Check for tournament advancement
  advanceTournament(winnerId, loserId)
}

function advanceTournament(winnerId, loserId) {
  // Advance the winner in the tournament bracket
  function advanceNode(node) {
    if (typeof node === "number") {
      return node === loserId ? winnerId : node
    }
    if (node.left === loserId || node.right === loserId) {
      return winnerId
    }
    return {
      left: advanceNode(node.left),
      right: advanceNode(node.right),
    }
  }
  bracket = advanceNode(bracket)

  // check if the opponent can be found and start next match
  function findMatch(node) {
    if (typeof node === "number") {
      return null
    }
    if (typeof node.left === "number" && typeof node.right === "number") {
      return [node.left, node.right]
    }
    return findMatch(node.left) || findMatch(node.right)
  }

  const nextMatch = findMatch(bracket)
  if (nextMatch) {
    const player1 = playerList.find((p) => p.id === nextMatch[0])
    const player2 = playerList.find((p) => p.id === nextMatch[1])
    if (player1 && player2) {
      startMatch(player1, player2)
    }
  } else {
    // Tournament over
    tournamentInProgress = false
    const championId = bracket
    const champion = playerList.find((p) => p.id === championId)
    if (champion) {
      champion.ws.send(JSON.stringify({ type: "tournamentEnd", message: "You are the tournament champion!" }))
    }
    // Notify all players
    playerList.forEach((p) => p.ws.send(JSON.stringify({ type: "tournamentEnd", championId: championId })))

    // disconect all players
    playerList.forEach((p) => p.ws.close())

    // close server
    console.log("Tournament ended. Shutting down server.")
    server.close()
  }
}

const PORT = process.env.PORT || 8080
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`)
})
