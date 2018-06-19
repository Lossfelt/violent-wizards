import React from 'react';
import { render } from 'react-dom';
import "./index.css";
import Enternames from "./enternames";
import Battle from "./battle"


class App extends React.Component {
  constructor(){
    super();
    this.state = {
      Player1: "",
      Player2: "",
      showEnterNames: true
    }
    this.hideEnterNames=this.hideEnterNames.bind(this);
    this.changeNames=this.changeNames.bind(this);
  }

  hideEnterNames = () => {
    this.setState({showEnterNames: false});
    if (this.state.Player1 === "") {this.setState({Player1: "Dust"})};
    if (this.state.Player2 === "") {this.setState({Player2: "Furu"})};
    console.log(this.state.Player1 + this.state.Player2);
  }

  changeNames = (e) => {
    this.setState({[e.target.id]: e.target.value});
  }

  render() {
    return(
  <div>
    <div className="title">Violent Wizards</div>
    <Enternames show={this.state.showEnterNames}
    player1={this.state.Player1}
    player2={this.state.Player2}
    hideThem={this.hideEnterNames}
    changeThem={this.changeNames} />
    <Battle player1={this.state.Player1}
    player2={this.state.Player2}
    show={this.state.showEnterNames} />
  </div>
);
  }
}
render(<App />, document.getElementById('root'));
