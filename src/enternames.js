import React from 'react';

const Enternames = (props) => {

  return (
  <div className={props.show ? "shown": "hidden"}>
    <h3>Enter player names</h3>
    <p>Player 1: <input id="Player1" onChange={props.changeThem} value={props.player1} /></p>
    <p>Player 2: <input id="Player2" onChange={props.changeThem} value={props.player2} /></p>
    <button onClick={props.hideThem} >OK</button>
  </div>
  )
}

export default Enternames;