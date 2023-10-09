# FUT AutoBuyer

<p align="center"> 
  <h3 align="center">UT MagicBuyer</h3>

  <p align="center">
    Autobuyer from EA FC Ultimate Team Webapp!
    <br />  
    <br /> 
    <a href="https://github.com/AMINE1921/MagicBuyer-UT/issues">Report Bug</a>
    ·
    <a href="https://github.com/AMINE1921/MagicBuyer-UT/issues">Request Feature</a>
    ·
  
  # Must Read :no_entry_sign:
  
  These tool is developed to demonstrate how someone can develop script to break our web application by automating stuffs and only for learning purpose.
  
   EA might (soft) ban from using transfer market in web app for using this tool. Continuously soft ban might lead to permanent ban as well. Also use of tools like this to gain advantage over other players is not ethically right.  
   
   Use this tool at your own risk, any developers contributing to this repo won’t held responsibility if your account gets banned.
  </p>
</p>

<!-- TABLE OF CONTENTS -->

## Table of Contents

- [Installation](#installation)

<!-- installation -->

## Installation

- Add Tamper Monkey Extenstion to your Browser - [Link](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=en-GB).
- Click on fut-auto-buyer.user.js from - [Latest Release](https://github.com/AMINE1921/MagicBuyer-UT/releases/).
- Then click on Install/Update.
- Installation And Demo - [Video Guide](https://www.youtube.com/watch?v=WATch4hxhtk).

Now in Ultimate Team Web App, new menu will be added as AutoBuyer.

<!-- Usage -->

## Usage

### AutoBuyer Settings

### Sell Price

- If specified the autobuyer will list the bought item for the specified price.
- The tool will list all the cards in transfer target, make sure to move your cards to the club before running the tool to avoid losing the card.
- Give Sell Price as -1 to move to transfer list without selling.

### Buy Price

- If specified the autobuyer will buy the card matching the search critieria for the price less than or equal to specified price.

### Bid Price

- If specified the autobuyer will bid on the card matching the search critieria for the price less than or equal to specified price.

### No. of cards to buy

- Number of cards the autobuyer should buy before auto stopping.
- Default Value (`10`).

### Bid Exact Price

- By default tool will bid for the lowest possible price and gradually increase the bid , if this flag is enabled bot will directly bid for the specified bid price.

### Find Sale Price

- If toggled will use FUTBIN price api to get the player price.

### Sell Price Percent

- When find sale price is toggled, this field is to specify the sale price from the percent of FUTBIN Price.
- Default Value (`100`).

### Bid items expiring in:

- If specified tool will only bid on items expiring in the given time range.
- Default Value (`1H`) (S for seconds, M for Minutes, H for hours).

### Relist Unsold Items:

- If enabled bot will periodically check and relist expired item for the previous specified price

### \* Note : This will relist all expired items , not only the item which bot list. So check the Transfer List before enabling this to avoid losing cards

### Wait Time

- The autobuyer will wait for the specified time before making the next search request.
- Default Value (`7 - 15`).

### Clear sold count

- The autobuyer will clear all the sold items from transfer list when the count exceeds the specified value.
- Default Value (`10`).

### Rating Threshold

- Will only list the card if the rating of the card is below this value.
- Default Value (`100`).

### Max purchases per search request

- Indicates the count of cards the tool should buy or bid from the results of each request.
- Default Value (`3`).

### Stop After

- If specified the tool will automatically stop after running the tool foe the specified interval.
- Default Value (`1H`) (S for seconds, M for Minutes, H for hours).

### Pause For

- The parameter has a dependency on Cycle Amount
- The tool will pause for the specified interval, if the the number of search request in the given cycle matches the specified cycle amount.
- Default Value (`0-0S`) (S for seconds, M for Minutes, H for hours).

### Pause Cycle

- Indicates the amount of search request to be made before pausing the tool.
- Default Value (`10`).

### Min Rating

- If specified tool will bid only on items which has rating greater or equal to this value.
- Default Value (`10`).

### Max Rating

- If specified tool will bid only on items which has rating lesser or equal to this value.
- Default Value (`100`).

### Delay To Add

- If add delay after buy is enabled, this field specifies the wait duration.
- Default Value (`1S`) (S for seconds, M for Minutes, H for hours).

### Add Delay After Buy

- If enabled tool will wait for the specified time after trying to buy/bid on cards.

### Max value of random min bid

- If use random min bid is enabled , this field specifies the maximum value till which min bid can be generated.
- Default Value (`300`).

### Max value of random min buy

- If use random min buy is enabled , this field specifies the maximum value till which min buy can be generated.
- Default Value (`300`).

### Use Random Min Bid

- If enabled tool will randomize min bid for each search to avoid cached result.

### Use Random Min Buy

- If enabled tool will randomize min buy for each search to avoid cached result.

### Skip GK

- If enabled tool will skip bidding/buying GK Cards.

### Close On Captcha Trigger

- If enabled tool will close the web app when Captcha gets triggered.

### Delay After Buy

- If enabled tool will add 1 second delay after each buy request.

### Error Codes to stop bot

- List of error code on which bot should stop, value should be in csv format.
- Ex - 421,461,512

### Sound Notification

- If enabled tool will gives sound notification for actions like buy card / captcha trigger etc...

## Prerequisites

- To use this tool, the user should have access to the transfer market.
- Hence play the required number of games to get access to the transfer market before trying this tool.