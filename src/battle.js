import React from 'react';
import {Gaussian} from './gaussian'

class Battle extends React.Component {
  constructor() {
    super();
    this.state = {
        P1H: 100,
        P2H: 100,
    }
    this.fireMissile=this.fireMissile.bind(this);
  }
  
  componentDidMount(){
    this.setState({
      P1SF: Math.floor(Math.random() * 360),
      P2SF: Math.floor(Math.random() * 360)
    });
      const P1M1 = Gaussian(0, 100, 1);
      const P1M2 = Gaussian(0, 100, 1);
      const P1M3 = Gaussian(0, 100, 1);
      const P1M4 = Gaussian(0, 100, 1);
      const P1M5 = Gaussian(0, 100, 1);
      const P2M1 = Gaussian(0, 100, 1);
      const P2M2 = Gaussian(0, 100, 1);
      const P2M3 = Gaussian(0, 100, 1);
      const P2M4 = Gaussian(0, 100, 1);
      const P2M5 = Gaussian(0, 100, 1);
      const P1M1F = Math.floor(Math.random() * 360);
      const P1M2F = Math.floor(Math.random() * 360);
      const P1M3F = Math.floor(Math.random() * 360);
      const P1M4F = Math.floor(Math.random() * 360);
      const P1M5F = Math.floor(Math.random() * 360);
      const P2M1F = Math.floor(Math.random() * 360);
      const P2M2F = Math.floor(Math.random() * 360);
      const P2M3F = Math.floor(Math.random() * 360);
      const P2M4F = Math.floor(Math.random() * 360);
      const P2M5F = Math.floor(Math.random() * 360);
      this.setState({
        P1M1: P1M1,
        P1M2: P1M2,
        P1M3: P1M3,
        P1M4: P1M4,
        P1M5: P1M5,
        P2M1: P2M1,
        P2M2: P2M2,
        P2M3: P2M3,
        P2M4: P2M4,
        P2M5: P2M5,
        P1M1F: P1M1F,
        P1M2F: P1M2F,
        P1M3F: P1M3F,
        P1M4F: P1M4F,
        P1M5F: P1M5F,
        P2M1F: P2M1F,
        P2M2F: P2M2F,
        P2M3F: P2M3F,
        P2M4F: P2M4F,
        P2M5F: P2M5F
    });
  }
  
  fireMissile = (e) => {
    var hitChance = 0
    var tryToHit = Math.random();
    if (e.target.id.substring(0,2) === "P1") {
    hitChance = this.state.P1H / (this.state.P1H + this.state.P2H);
    }
    if (e.target.id.substring(0,2) === "P2") {
    hitChance = this.state.P2H / (this.state.P1H + this.state.P2H);
    }
    if (tryToHit < hitChance) {
      var missile = ""
      var dist = ""
      var hitForce = 0
      if (e.target.id.substring(0,2) === "P1") {
        missile = e.target.id + "F"
      dist = Math.abs(this.state[missile] % 360 - this.state.P2SF % 360)
      }
      if (e.target.id.substring(0,2) === "P2") {
        missile = e.target.id + "F"
      dist = Math.abs(this.state[missile] % 360 - this.state.P1SF % 360)
      }
      dist = Math.min(dist, 360 - dist)
      if (e.target.id.substring(0,2) === "P1") {
      hitForce = this.state[e.target.id] * (dist / 180)
      this.setState(prevstate => ({
        P2H: Math.ceil(prevstate.P2H - hitForce)
      }));
      }
      if (e.target.id.substring(0,2) === "P2") {
      hitForce = this.state[e.target.id] * (dist / 180)
      this.setState(prevstate => ({
        P1H: Math.ceil(prevstate.P1H - hitForce)
      }));
      }
      console.log("HIT! " + tryToHit + " is less than " + hitChance)
      console.log("dist: " + dist + " dist-partial: " + (dist/180) + " hitforce: " + hitForce)
    } else {
      console.log("miss, sadly...")
    }
      this.setState({[e.target.id+"U"]: true});
  }

  
  render() {
          
    return(
      <div className={this.props.show ? "hidden" : "shown"}>
        <h1>{this.props.player1} VS {this.props.player2}</h1>
        <div className="grid-container">
          <div className="gid-item">Health</div>
          <div className="gid-item">{this.state.P1H}</div>
          <div className="gid-item">Health</div>
          <div className="gid-item">{this.state.P2H}</div>
          <div className="gid-item">Shield Frequency</div>
          <div className="gid-item">{this.state.P1SF}</div>
          <div className="gid-item">Shield Frequency</div>
          <div className="gid-item">{this.state.P2SF}</div>
          <div className="gid-item">Missile 1</div>
          <div className="gid-item"><button id="P1M1" onClick={this.fireMissile} disabled={this.state.P1M1U} >{this.state.P1M1}</button>{this.state.P1M1F}</div>
          <div className="gid-item">Missile 1</div>
          <div className="gid-item"><button id="P2M1" onClick={this.fireMissile} disabled={this.state.P2M1U} >{this.state.P2M1}</button>{this.state.P2M1F}</div>
          <div className="gid-item">Missile 2</div>
          <div className="gid-item"><button id="P1M2" onClick={this.fireMissile} disabled={this.state.P1M2U} >{this.state.P1M2}</button>{this.state.P1M2F}</div>
          <div className="gid-item">Missile 2</div>
          <div className="gid-item"><button id="P2M2" onClick={this.fireMissile} disabled={this.state.P2M2U} >{this.state.P2M2}</button>{this.state.P2M2F}</div>
          <div className="gid-item">Missile 3</div>
          <div className="gid-item"><button id="P1M3" onClick={this.fireMissile} disabled={this.state.P1M3U} >{this.state.P1M3}</button>{this.state.P1M3F}</div>
          <div className="gid-item">Missile 3</div>
          <div className="gid-item"><button id="P2M3" onClick={this.fireMissile} disabled={this.state.P2M3U} >{this.state.P2M3}</button>{this.state.P2M3F}</div>
          <div className="gid-item">Missile 4</div>
          <div className="gid-item"><button id="P1M4" onClick={this.fireMissile} disabled={this.state.P1M4U} >{this.state.P1M4}</button>{this.state.P1M4F}</div>
          <div className="gid-item">Missile 4</div>
          <div className="gid-item"><button id="P2M4" onClick={this.fireMissile} disabled={this.state.P2M4U} >{this.state.P2M4}</button>{this.state.P2M4F}</div>
          <div className="gid-item">Missile 5</div>
          <div className="gid-item"><button id="P1M5" onClick={this.fireMissile} disabled={this.state.P1M5U} >{this.state.P1M5}</button>{this.state.P1M5F}</div>
          <div className="gid-item">Missile 5</div>
          <div className="gid-item"><button id="P2M5" onClick={this.fireMissile} disabled={this.state.P2M5U} >{this.state.P2M5}</button>{this.state.P2M5F}</div>
        </div>
      </div>
    )
  }
}


export default Battle;