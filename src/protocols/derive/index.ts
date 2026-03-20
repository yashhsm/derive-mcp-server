import type { Protocol } from "./types.js";

// Public: Market Data
import { getInstruments } from "./public/market-data/get-instruments.js";
import { getAllInstruments } from "./public/market-data/get-all-instruments.js";
import { getTicker } from "./public/market-data/get-ticker.js";
import { getTickers } from "./public/market-data/get-tickers.js";

import { getTradeHistoryPublic } from "./public/market-data/get-trade-history.js";
import { getFundingRateHistory } from "./public/market-data/get-funding-rate-history.js";
import { getLiquidationHistory } from "./public/market-data/get-liquidation-history.js";
import { getInterestRateHistory } from "./public/market-data/get-interest-rate-history.js";
import { getTransaction } from "./public/market-data/get-transaction.js";

import { getOptionsChain } from "./public/market-data/get-options-chain.js";

// Public: Charts
import { getIndexChartData } from "./public/charts/get-index-chart-data.js";
import { getTradingviewChartData } from "./public/charts/get-tradingview-chart-data.js";


// Private: Account
import { getAccount } from "./private/account/get-account.js";
import { getSubaccounts } from "./private/account/get-subaccounts.js";
import { getSubaccount } from "./private/account/get-subaccount.js";
import { setCancelOnDisconnect } from "./private/account/set-cancel-on-disconnect.js";
import { getNotifications } from "./private/account/get-notifications.js";

// Private: Positions
import { getPositions } from "./private/positions/get-positions.js";
import { getCollaterals } from "./private/positions/get-collaterals.js";
import { getMargin } from "./private/positions/get-margin.js";
import { getPortfolioSummary } from "./private/positions/get-portfolio-summary.js";

// Private: Orders
import { placeOrder } from "./private/orders/place-order.js";
import { replaceOrder } from "./private/orders/replace-order.js";
import { cancelOrder } from "./private/orders/cancel-order.js";
import { cancelByInstrument } from "./private/orders/cancel-by-instrument.js";
import { cancelByLabel } from "./private/orders/cancel-by-label.js";
import { cancelAllOrders } from "./private/orders/cancel-all-orders.js";
import { getOpenOrders } from "./private/orders/get-open-orders.js";
import { getOrder } from "./private/orders/get-order.js";
import { getOrderHistory } from "./private/orders/get-order-history.js";
import { getTradeHistoryPrivate } from "./private/orders/get-trade-history.js";

// Private: RFQ
import { sendRfq } from "./private/rfq/send-rfq.js";
import { getRfqs } from "./private/rfq/get-rfqs.js";
import { cancelRfq } from "./private/rfq/cancel-rfq.js";
import { getQuotes } from "./private/rfq/get-quotes.js";
import { executeQuote } from "./private/rfq/execute-quote.js";

// Private: Transfers
import { getDepositHistory } from "./private/transfers/get-deposit-history.js";
import { getWithdrawalHistory } from "./private/transfers/get-withdrawal-history.js";
import { getErc20TransferHistory } from "./private/transfers/get-erc20-transfer-history.js";

// Private: MMP
import { getMmpConfig } from "./private/mmp/get-mmp-config.js";
import { setMmpConfig } from "./private/mmp/set-mmp-config.js";
import { resetMmp } from "./private/mmp/reset-mmp.js";

// Private: Session
import { getSessionKeys } from "./private/session/get-session-keys.js";

export const derive: Protocol = {
  name: "derive",
  actions: {
    // Public: Market Data
    get_instruments: getInstruments,
    get_all_instruments: getAllInstruments,
    get_ticker: getTicker,
    get_tickers: getTickers,
    get_options_chain: getOptionsChain,
    get_trade_history_public: getTradeHistoryPublic,
    get_funding_rate_history: getFundingRateHistory,
    get_liquidation_history: getLiquidationHistory,
    get_interest_rate_history: getInterestRateHistory,
    get_transaction: getTransaction,

    // Public: Charts
    get_index_chart_data: getIndexChartData,
    get_tradingview_chart_data: getTradingviewChartData,

    // Private: Account
    get_account: getAccount,
    get_subaccounts: getSubaccounts,
    get_subaccount: getSubaccount,
    set_cancel_on_disconnect: setCancelOnDisconnect,
    get_notifications: getNotifications,

    // Private: Positions
    get_positions: getPositions,
    get_collaterals: getCollaterals,
    get_margin: getMargin,
    get_portfolio_summary: getPortfolioSummary,

    // Private: Orders
    place_order: placeOrder,
    replace_order: replaceOrder,
    cancel_order: cancelOrder,
    cancel_by_instrument: cancelByInstrument,
    cancel_by_label: cancelByLabel,
    cancel_all_orders: cancelAllOrders,
    get_open_orders: getOpenOrders,
    get_order: getOrder,
    get_order_history: getOrderHistory,
    get_trade_history_private: getTradeHistoryPrivate,

    // Private: RFQ
    send_rfq: sendRfq,
    get_rfqs: getRfqs,
    cancel_rfq: cancelRfq,
    get_quotes: getQuotes,
    execute_quote: executeQuote,

    // Private: Transfers
    get_deposit_history: getDepositHistory,
    get_withdrawal_history: getWithdrawalHistory,
    get_erc20_transfer_history: getErc20TransferHistory,

    // Private: MMP
    get_mmp_config: getMmpConfig,
    set_mmp_config: setMmpConfig,
    reset_mmp: resetMmp,

    // Private: Session
    get_session_keys: getSessionKeys,
  },
};
