import debug from 'debug'
import BigNumber from 'bignumber.js'
import SwapApp, { Events, util } from 'swap.app'
import SwapInterface from 'swap.app/SwapInterface'
import Room from './Room'
import { Flow as FlowType } from 'swap.swap'
import { COIN_DATA, COIN_MODEL, COIN_TYPE } from 'swap.app/constants/COINS'


class Swap {

  id: string
  isMy: boolean
  isTurbo: boolean
  owner: any
  participant: any
  buyCurrency: string // @ToDo CoinType
  sellCurrency: string// @ToDo CoinType
  buyAmount: BigNumber
  sellAmount: BigNumber
  ownerSwap: any
  participantSwap: any
  destinationBuyAddress: any
  destinationSellAddress: any
  app: SwapApp
  createUnixTimeStamp: number
  participantMetamaskAddress: any
  waitConfirm: boolean
  events: Events
  room: Room
  flow: FlowType

  constructor(id, app, order?) {
    this.id                     = null
    this.isMy                   = null
    this.isTurbo                = null
    this.owner                  = null
    this.participant            = null
    this.buyCurrency            = null
    this.sellCurrency           = null
    this.buyAmount              = null
    this.sellAmount             = null
    this.ownerSwap              = null
    this.participantSwap        = null
    this.destinationBuyAddress  = null
    this.destinationSellAddress = null
    this.app                    = null
    this.createUnixTimeStamp    = Math.floor(new Date().getTime() / 1000)

    this.participantMetamaskAddress = null

    // Wait confirm > 1
    this.waitConfirm            = false

    this._attachSwapApp(app)

    let data = this.app.env.storage.getItem(`swap.${id}`)

    if (!data) {
      order = order || this.app.services.orders.getByKey(id)

      data = this._getDataFromOrder(order)
    }

    this.update(data)

    this.events = new Events()

    this.room = new Room(app, {
      swapId: id,
      participantPeer: this.participant.peer,
    })

    this.ownerSwap        = this.app.swaps[data.buyCurrency.toUpperCase()]
    this.participantSwap  = this.app.swaps[data.sellCurrency.toUpperCase()]

    const flowKey = this.isTurbo ?
      (this.isMy ? 'TurboMaker' : 'TurboTaker')
      :
      `${data.sellCurrency.toUpperCase()}2${data.buyCurrency.toUpperCase()}`

    if (!this.app.flows[flowKey]) {
      throw new Error(`Flow with name "${flowKey}" not found in SwapApp.flows`)
    }

    const Flow = this.app.flows[flowKey]
    this.flow = new Flow(this)
    console.log(`Flow "${flowKey}" created!`)

    this.setupEvents()
    // Change destination address on run time
    this.room.on('set destination buy address', (data) => {
      debug('swap.core:swap')('Other side change destination buy address', data)
      this.update({
        destinationSellAddress: data.address,
      })
    })

    this.room.on('set destination sell address', (data) => {
      debug('swap.core:swap')('Other side change destination sell address', data)
      this.update({
        destinationBuyAddress: data.address,
      })
    })

    this.room.on('set metamask address', (data) => {
      debug('swap.core:swap')('Participant use metamask')
      this.update({
        participantMetamaskAddress: data.address,
      })
    })
  }

/* static read(app, { id }) {
    SwapApp.required(app)

    if (!id) {
      debug('swap.core:swap')(`SwapReadError: id not given: ${id}`)
      return {}
    }

    const data = app.env.storage.getItem(`swap.${id}`)

    if (!data) {
      debug('swap.core:swap')(`SwapReadError: No swap with id=${id}`)
      return {}
    }

    const flowKey = this.isTurbo ?
      (this.isMy ? 'TurboMaker' : 'TurboTaker')
      :
      `${data.sellCurrency.toUpperCase()}2${data.buyCurrency.toUpperCase()}`

    if (!app.flows[flowKey]) {
      throw new Error(`Flow with name "${flowKey}" not found in SwapApp.flows`)
    }

    const Flow = app.flows[flowKey]
    data.flow = Flow.read(app, data)

    return data
  }*/

  isFinished(): boolean {
    return this.flow.isFinished()
  }

  _attachSwapApp(app) {
    SwapApp.required(app)

    this.app = app
    this.app.attachSwap(this)
  }

  _getDataFromOrder(order) {
    // TODO add check order format (typeforce)

    const data = util.pullProps(
      order,
      'id',
      'isMy',
      'isTurbo',
      'owner',
      'participant',
      'sellCurrency',
      'sellAmount',
      'buyCurrency',
      'buyAmount',
      'destination',
    )

    const {
      //@ts-ignore
      isMy,
      //@ts-ignore
      isTurbo,
      //@ts-ignore
      sellCurrency,
      //@ts-ignore
      sellAmount,
      //@ts-ignore
      buyCurrency,
      //@ts-ignore
      buyAmount,
      //@ts-ignore
      destination,
      ...rest
    } = data

    const { ownerAddress, participantAddress } = destination

    const swap = {
      ...rest,
      isMy,
      isTurbo,
      sellCurrency: isMy ? sellCurrency : buyCurrency,
      sellAmount: isMy ? sellAmount : buyAmount,
      buyCurrency: isMy ? buyCurrency : sellCurrency,
      buyAmount: isMy ? buyAmount : sellAmount,
      destinationBuyAddress: isMy ? ownerAddress : participantAddress,
      destinationSellAddress: isMy ? participantAddress : ownerAddress,
    }
    //@ts-ignore
    if (!swap.participant && !isMy) {
      //@ts-ignore
      swap.participant = swap.owner
    }

    return swap
  }

  _pullRequiredData(data) {
    return util.pullProps(
      data,
      'id',
      'isMy',
      'isTurbo',
      'owner',
      'participant',
      'sellCurrency',
      'sellAmount',
      'buyCurrency',
      'buyAmount',
      'destinationBuyAddress',
      'destinationSellAddress',
      'createUnixTimeStamp',
      'participantMetamaskAddress',
      'waitConfirm',
    )
  }

  _saveState() {
    const data = this._pullRequiredData(this)

    this.app.env.storage.setItem(`swap.${this.id}`, data)
  }

  checkTimeout(timeoutUTS) {
    // return true if timeout passed
    return !((this.createUnixTimeStamp + timeoutUTS) > Math.floor(new Date().getTime() / 1000))
  }

  setupEvents() {
    const {
      sellCurrency: sellCoin,
      buyCurrency: buyCoin,
    } = this

    if (!this.flow.isTakerMakerModel) {
      if (COIN_DATA[sellCoin]
        && COIN_DATA[sellCoin].model
        && COIN_DATA[buyCoin]
        && COIN_DATA[buyCoin].model
      ) {
        const _Sell = sellCoin.toLowerCase()
        const _Buy = buyCoin.toLowerCase()

        const sellModel = COIN_DATA[sellCoin].model
        const buyModel = COIN_DATA[buyCoin].model

        // sell UTXO buy AB 
        if (sellModel === COIN_MODEL.UTXO && buyModel === COIN_MODEL.AB) {
          // @ToDo after refactoring use 'request script'
          this.room.on(`request utxo script`, () => {
            if (this.flow) {
              const {
                utxoScriptValues: scriptValues,
                utxoScriptCreatingTransactionHash: scriptCreatingTransactionHash,
              } = this.flow.state
              
              if (scriptValues && scriptCreatingTransactionHash) {
                this.room.sendMessage({
                  event:  `create utxo script`,
                  data: {
                    scriptValues,
                    utxoScriptCreatingTransactionHash: scriptCreatingTransactionHash,
                  }
                })
              }
            }
          })
        }
        // sell AB buy UTXO
        if (sellModel === COIN_MODEL.AB && buyModel === COIN_MODEL.UTXO) {
          this.room.on(`create utxo script`, (eventData) => {
            if (this.flow) {
              const {
                scriptValues,
                utxoScriptCreatingTransactionHash: scriptCreatingTransactionHash, 
              } = eventData

              const { step } = this.flow.state

              if (step >= 3) {
                return
              }

              this.flow.finishStep({
                secretHash: scriptValues.secretHash,
                utxoScriptValues: scriptValues,
                utxoScriptCreatingTransactionHash: scriptCreatingTransactionHash,
              }, { step: `wait-lock-utxo`, silentError: true })
            }
          })
          // Seller has unconfirmed tx in mem pool
          this.room.on('wait utxo unlock', () => {
            this.flow.setState({
              participantHasLockedUTXO: true,
            }, true)
          })

          const requestScriptFunc = () => {
            if (this.flow && !this.flow._isFinished()) {
              const { step } = this.flow.state

              if (step >= 3) {
                return
              }

              this.flow.swap.room.sendMessage({
                event: `request ${_Buy} script`,
              })

              setTimeout( requestScriptFunc, 5000 )
            }
          }
          requestScriptFunc()
        }
        // sell UTXO buy UTXO
        if (sellModel === COIN_MODEL.UTXO && buyModel === COIN_MODEL.UTXO) { /* ---- */ }
        // sell AB buy AB
        if (sellModel === COIN_MODEL.AB && buyModel === COIN_MODEL.AB) { /* ----- */ }
      } else {
        console.warn(`Core->Swap->setupEvents - Unknown coins models Sell(${sellCoin}) Buy(${buyCoin})`)
      }
    }
  }

  needWaitConfirm() {
    this.update({
      waitConfirm: true,
    })
  }

  processMetamask() {
    if (this.app.env.metamask
      && this.app.env.metamask.isEnabled()
      && this.app.env.metamask.isConnected()
    ) {
      this.room.sendMessage({
        event: 'set metamask address',
        data: {
          address: this.app.env.metamask.getAddress(),
        },
      })
    }
  }

  setDestinationBuyAddress(address) {
    this.update({
      destinationBuyAddress: address,
    })

    this.room.sendMessage({
      event: 'set destination buy address',
      data: {
        address,
      },
    })
  }

  setDestinationSellAddress(address) {
    this.update({
      destinationSellAddress: address,
    })

    this.room.sendMessage({
      event: 'set destination sell address',
      data: {
        address,
      },
    })
  }

  update(values) {
    Object.keys(values).forEach((key) => {
      if (key === 'buyAmount' || key === 'sellAmount') {
        this[key] = new BigNumber(String(values[key]))
      }
      else {
        this[key] = values[key]
      }
    })
    this._saveState()
  }

  on(eventName, handler) {
    this.events.subscribe(eventName, handler)
  }

  off(eventName, handler) {
    this.events.unsubscribe(eventName, handler)
  }
}


export default Swap
