# Notes on learning

A small model can make a large idea easier to understand. These notes connect the equations to the decisions we make when training a model.

## Start with a prediction

For a linear model, the prediction is a weighted sum of the inputs:

$$
\hat{y} = w^{\mathsf T}x + b
$$

Here, $x$ is the input, $w$ contains the weights, and $b$ is the bias. Training adjusts the parameters so that predictions move closer to observed outcomes.

## Measure the error

The mean squared error gives larger mistakes more weight:

$$
\mathcal{L}(w,b)=\frac{1}{n}\sum_{i=1}^{n}\left(y_i-\hat{y}_i\right)^2
$$

A lower training loss is useful, but it is not the whole goal. We also need the model to work on examples it has never seen.

## Take a small step

Gradient descent updates the parameters in the direction that reduces the loss:

$$
w_{t+1}=w_t-\eta\nabla_w\mathcal{L}(w_t,b_t)
$$

| Choice | Too small | Too large |
| --- | --- | --- |
| Learning rate | Slow progress | Unstable training |
| Model capacity | Missed patterns | Overfitting |
| Validation set | Noisy estimates | Less training data |

## Questions to ask next

- Is the validation loss improving?
- Are the inputs scaled consistently?
- What kinds of examples fail most often?

A useful experiment changes one assumption at a time and records what happened.
